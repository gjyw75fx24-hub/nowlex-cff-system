import os

import redis
from rq import Queue


PASSIVAS_IMPORT_QUEUE = "passivas_import"


def _get_queue_redis_url():
    return (
        os.getenv("IMPORT_QUEUE_REDIS_URL")
        or os.getenv("REDIS_URL")
        or os.getenv("ONLINE_PRESENCE_REDIS_URL")
    )


def get_queue_connection():
    redis_url = _get_queue_redis_url()
    if not redis_url:
        raise RuntimeError(
            "Redis URL não configurada. Defina IMPORT_QUEUE_REDIS_URL ou REDIS_URL."
        )
    return redis.from_url(redis_url)


def get_passivas_import_queue():
    return Queue(PASSIVAS_IMPORT_QUEUE, connection=get_queue_connection(), default_timeout=3600)
