"""
In-memory audience cache for natural-language query results.

A user query like "users who haven't received a campaign yet" can return
hundreds of thousands of id_clients. Shipping that list back to the frontend
and re-sending it on every analytics request as a comma-joined query string
overflows server URL limits (~8KB).

Instead, the query router stashes the id list under an opaque token here, and
the frontend sends just the token (?audience=abc...). filter_helpers.build_where
resolves the token back to the id list at query time.

This is process-local memory -- fine for a single uvicorn worker / single dev
machine. For multi-worker production deploy, swap the dict for Redis with the
same get/put interface.
"""
from __future__ import annotations

import secrets
import threading
import time
from typing import Optional


class _Entry:
    __slots__ = ("ids", "created_at", "question", "sql")

    def __init__(self, ids: list[int], question: str, sql: str):
        self.ids = ids
        self.question = question
        self.sql = sql
        self.created_at = time.time()


# Cap how many distinct audiences we keep around. Each entry can hold ~300K
# ids (a few MB). 32 audiences * a few MB is fine for a dev machine.
_MAX_ENTRIES = 32

# Audiences that haven't been read in this long get evicted.
_TTL_SECONDS = 60 * 60 * 6  # 6 hours

_lock = threading.Lock()
_store: dict[str, _Entry] = {}


def _evict_expired_locked() -> None:
    cutoff = time.time() - _TTL_SECONDS
    expired = [k for k, v in _store.items() if v.created_at < cutoff]
    for k in expired:
        _store.pop(k, None)


def _evict_oldest_locked() -> None:
    while len(_store) >= _MAX_ENTRIES:
        oldest_key = min(_store, key=lambda k: _store[k].created_at)
        _store.pop(oldest_key, None)


def put(ids: list[int], question: str = "", sql: str = "") -> str:
    """Store an id list and return an opaque token to retrieve it with."""
    token = secrets.token_urlsafe(12)
    with _lock:
        _evict_expired_locked()
        _evict_oldest_locked()
        _store[token] = _Entry(list(ids), question, sql)
    return token


def get(token: str) -> Optional[list[int]]:
    """Return the id list for a token, or None if missing/expired."""
    if not token:
        return None
    with _lock:
        entry = _store.get(token)
        if entry is None:
            return None
        if time.time() - entry.created_at > _TTL_SECONDS:
            _store.pop(token, None)
            return None
        return entry.ids


def info(token: str) -> Optional[dict]:
    """Diagnostic — caller-facing metadata about an audience."""
    with _lock:
        entry = _store.get(token)
        if entry is None:
            return None
        return {
            "size": len(entry.ids),
            "question": entry.question,
            "sql": entry.sql,
            "created_at": entry.created_at,
        }
