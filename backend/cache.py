"""Optional Redis cache shared by all backend workers."""

from __future__ import annotations

import hashlib
import os
import pickle
from time import monotonic

_client = None
_blocking_client = None
_retry_after = 0.0


def _redis_client():
    global _client, _retry_after
    url = os.getenv("REDIS_URL")
    if not url or monotonic() < _retry_after:
        return None
    if _client is None:
        try:
            import redis
            _client = redis.Redis.from_url(
                url,
                socket_connect_timeout=1,
                socket_timeout=1,
                health_check_interval=30,
            )
            _client.ping()
        except Exception:
            _client = None
            _retry_after = monotonic() + 10
            return None
    return _client


def redis_client(blocking: bool = False):
    global _blocking_client
    if not blocking:
        return _redis_client()
    url = os.getenv("REDIS_URL")
    if not url:
        return None
    if _blocking_client is None:
        try:
            import redis
            _blocking_client = redis.Redis.from_url(
                url,
                socket_connect_timeout=2,
                socket_timeout=None,
                health_check_interval=30,
            )
            _blocking_client.ping()
        except Exception:
            _blocking_client = None
            return None
    return _blocking_client


def cache_key(namespace: str, version, key: tuple) -> str:
    digest = hashlib.sha256(pickle.dumps((version, key))).hexdigest()
    return f"amoebascope:v1:{namespace}:{digest}"


def get_shared(namespace: str, version, key: tuple):
    client = _redis_client()
    if client is None:
        return None, False
    try:
        value = client.get(cache_key(namespace, version, key))
        return (pickle.loads(value), True) if value is not None else (None, False)
    except Exception:
        return None, False


def set_shared(namespace: str, version, key: tuple, value, ttl: int):
    client = _redis_client()
    if client is None:
        return
    try:
        client.setex(cache_key(namespace, version, key), ttl, pickle.dumps(value))
    except Exception:
        pass
