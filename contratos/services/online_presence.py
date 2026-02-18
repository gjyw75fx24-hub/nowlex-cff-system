import logging
import re
import time
from typing import Any

from django.conf import settings

try:
    import redis
except ImportError:  # pragma: no cover - guarded fallback when dependency is missing
    redis = None


logger = logging.getLogger(__name__)

KEY_PREFIX = "nowlex:online_presence:tab:"
SCAN_PATTERN = f"{KEY_PREFIX}*"
TOKEN_SALT = "processo-online-presence"

_redis_client = None
_redis_client_url = None


def _to_positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return int(default)
    return parsed if parsed > 0 else int(default)


def get_presence_settings() -> dict[str, int]:
    heartbeat_seconds = _to_positive_int(
        getattr(settings, "ONLINE_PRESENCE_HEARTBEAT_SECONDS", 15),
        15,
    )
    ttl_seconds = _to_positive_int(
        getattr(settings, "ONLINE_PRESENCE_TTL_SECONDS", 60),
        60,
    )
    idle_seconds = _to_positive_int(
        getattr(settings, "ONLINE_PRESENCE_IDLE_SECONDS", 300),
        300,
    )
    if ttl_seconds < heartbeat_seconds:
        ttl_seconds = heartbeat_seconds
    if idle_seconds < heartbeat_seconds:
        idle_seconds = heartbeat_seconds
    return {
        "heartbeat_seconds": heartbeat_seconds,
        "ttl_seconds": ttl_seconds,
        "idle_seconds": idle_seconds,
    }


def get_redis_url() -> str:
    value = str(getattr(settings, "ONLINE_PRESENCE_REDIS_URL", "") or "").strip()
    return value


def get_redis_client():
    global _redis_client, _redis_client_url

    if redis is None:
        return None

    redis_url = get_redis_url()
    if not redis_url:
        return None

    if _redis_client is not None and _redis_client_url == redis_url:
        return _redis_client

    try:
        client = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
            health_check_interval=30,
            retry_on_timeout=True,
        )
        client.ping()
    except Exception as exc:  # pragma: no cover - external connectivity branch
        logger.warning("Online presence Redis indisponivel: %s", exc)
        _redis_client = None
        _redis_client_url = None
        return None

    _redis_client = client
    _redis_client_url = redis_url
    return _redis_client


def is_online_presence_enabled() -> bool:
    return get_redis_client() is not None


def _clean_identifier(value: Any, max_len: int = 80) -> str:
    text = str(value or "").strip()
    text = re.sub(r"[^a-zA-Z0-9._:-]", "", text)
    if len(text) > max_len:
        text = text[:max_len]
    return text


def build_tab_key(user_id: Any, session_key: Any, tab_id: Any) -> str:
    user_part = _clean_identifier(user_id)
    session_part = _clean_identifier(session_key)
    tab_part = _clean_identifier(tab_id)
    if not user_part or not tab_part:
        return ""
    if not session_part:
        session_part = "session"
    return f"{KEY_PREFIX}{user_part}:{session_part}:{tab_part}"


def record_online_presence(
    *,
    user_id: int,
    user_label: str,
    session_key: str,
    tab_id: str,
    processo_id: int,
    processo_label: str,
    carteira_id: int,
    carteira_label: str,
    current_path: str = "",
    is_visible: bool = True,
    last_interaction_ts: int | None = None,
) -> bool:
    client = get_redis_client()
    if client is None:
        return False

    tab_key = build_tab_key(user_id, session_key, tab_id)
    if not tab_key:
        return False

    settings_map = get_presence_settings()
    ttl_seconds = int(settings_map["ttl_seconds"])
    now_ts = int(time.time())
    interaction_ts = _to_positive_int(last_interaction_ts, now_ts)

    try:
        prev_process_id, prev_started_at, prev_last_interaction = client.hmget(
            tab_key,
            ["processo_id", "started_at", "last_interaction_at"],
        )
    except Exception:  # pragma: no cover - external connectivity branch
        return False

    current_process_str = str(int(processo_id))
    if str(prev_process_id or "") == current_process_str and prev_started_at:
        started_at = _to_positive_int(prev_started_at, now_ts)
    else:
        started_at = now_ts

    prev_interaction = _to_positive_int(prev_last_interaction, 0)
    if interaction_ts < prev_interaction:
        interaction_ts = prev_interaction
    if interaction_ts > now_ts:
        interaction_ts = now_ts

    payload = {
        "user_id": str(int(user_id)),
        "user_label": str(user_label or "").strip() or f"Usuário {int(user_id)}",
        "session_key": str(session_key or "").strip(),
        "tab_id": _clean_identifier(tab_id),
        "processo_id": current_process_str,
        "processo_label": str(processo_label or "").strip() or f"Cadastro #{int(processo_id)}",
        "carteira_id": str(int(carteira_id or 0)),
        "carteira_label": str(carteira_label or "").strip(),
        "path": str(current_path or "").strip(),
        "visible": "1" if is_visible else "0",
        "started_at": str(started_at),
        "last_seen_at": str(now_ts),
        "last_interaction_at": str(interaction_ts),
    }
    try:
        pipe = client.pipeline()
        pipe.hset(tab_key, mapping=payload)
        pipe.expire(tab_key, ttl_seconds)
        pipe.execute()
    except Exception:  # pragma: no cover - external connectivity branch
        return False
    return True


def list_online_presence_rows() -> list[dict[str, Any]]:
    client = get_redis_client()
    if client is None:
        return []

    settings_map = get_presence_settings()
    ttl_seconds = int(settings_map["ttl_seconds"])
    idle_seconds = int(settings_map["idle_seconds"])
    now_ts = int(time.time())

    try:
        keys = list(client.scan_iter(match=SCAN_PATTERN, count=500))
    except Exception:  # pragma: no cover - external connectivity branch
        return []

    if not keys:
        return []

    rows: list[dict[str, Any]] = []
    pipe = client.pipeline()
    for key in keys:
        pipe.hgetall(key)
    try:
        entries = pipe.execute()
    except Exception:  # pragma: no cover - external connectivity branch
        return []

    for key, item in zip(keys, entries):
        if not item:
            continue
        processo_id = _to_positive_int(item.get("processo_id"), 0)
        user_id = _to_positive_int(item.get("user_id"), 0)
        if not processo_id or not user_id:
            continue
        started_at = _to_positive_int(item.get("started_at"), now_ts)
        last_seen_at = _to_positive_int(item.get("last_seen_at"), 0)
        last_interaction_at = _to_positive_int(item.get("last_interaction_at"), last_seen_at)
        elapsed_seconds = max(0, now_ts - started_at)
        idle_for_seconds = max(0, now_ts - last_interaction_at)
        rows.append(
            {
                "key": str(key),
                "user_id": int(user_id),
                "user_label": str(item.get("user_label") or f"Usuário {user_id}"),
                "processo_id": int(processo_id),
                "processo_label": str(item.get("processo_label") or f"Cadastro #{processo_id}"),
                "carteira_id": _to_positive_int(item.get("carteira_id"), 0),
                "carteira_label": str(item.get("carteira_label") or ""),
                "session_key": str(item.get("session_key") or ""),
                "tab_id": str(item.get("tab_id") or ""),
                "path": str(item.get("path") or ""),
                "visible": str(item.get("visible") or "1") == "1",
                "started_at": int(started_at),
                "last_seen_at": int(last_seen_at),
                "last_interaction_at": int(last_interaction_at),
                "elapsed_seconds": int(elapsed_seconds),
                "idle_for_seconds": int(idle_for_seconds),
                "is_idle": bool(idle_for_seconds >= idle_seconds),
                "is_online": bool(last_seen_at and (now_ts - last_seen_at) <= ttl_seconds),
            }
        )

    rows.sort(
        key=lambda row: (
            str(row.get("user_label") or "").upper(),
            -int(row.get("last_seen_at") or 0),
            str(row.get("tab_id") or ""),
        )
    )
    return rows
