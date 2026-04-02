from __future__ import annotations

import hashlib


_STATUS_PREPOSITIONS = {
    "a",
    "as",
    "com",
    "da",
    "das",
    "de",
    "do",
    "dos",
    "e",
    "em",
    "na",
    "nas",
    "no",
    "nos",
    "para",
    "por",
}


def normalize_status_processual_nome(value: str | None) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    parts = []
    for index, token in enumerate(text.split()):
        cleaned = token.strip().lower()
        if not cleaned:
            continue
        if index > 0 and cleaned in _STATUS_PREPOSITIONS:
            parts.append(cleaned)
        else:
            parts.append(cleaned.title())
    return " ".join(parts)


def build_safe_status_processual_nome(value: str | None, max_len: int = 100) -> str:
    normalized = normalize_status_processual_nome(value)
    if not normalized:
        return ""
    if len(normalized) <= max_len:
        return normalized
    digest = hashlib.md5(normalized.encode("utf-8")).hexdigest()[:12]
    suffix = f" [{digest}]"
    base_len = max(1, max_len - len(suffix))
    return normalized[:base_len].rstrip() + suffix
