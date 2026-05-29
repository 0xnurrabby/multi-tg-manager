"""Local-only store for remembered Telegram 2FA (Two-Step) passwords.

This is a single-user, local tool. We persist 2FA passwords the user typed at
login so bulk operations (e.g. bulk 2FA change) can re-supply them without the
user re-typing 42 passwords. Stored as plain JSON in the sessions folder:

    <SESSIONS_DIR>/twofa.json  ->  { "+8801...": "password", ... }

Keep it out of any export/backup that leaves the machine.
"""
from __future__ import annotations
import asyncio
import json
import os
import re
from pathlib import Path

from .config import settings

_lock = asyncio.Lock()


def _path() -> Path:
    return settings.sessions_path / "twofa.json"


def _norm_phone(phone: str) -> str:
    p = (phone or "").strip()
    if not p:
        return p
    digits = re.sub(r"[^0-9]", "", p)
    return f"+{digits}" if digits else p


def _read() -> dict[str, str]:
    p = _path()
    try:
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8") or "{}")
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def _write(data: dict[str, str]):
    """Atomically persist the store (temp file + os.replace). Raises on failure
    so callers that need to know the password was saved can react instead of
    silently losing it."""
    p = _path()
    tmp = p.parent / (p.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


async def save_2fa(phone: str, password: str):
    if not phone or not password:
        return
    key = _norm_phone(phone)
    async with _lock:
        data = _read()
        data[key] = password
        _write(data)


async def get_2fa(phone: str) -> str | None:
    key = _norm_phone(phone)
    async with _lock:
        return _read().get(key)


async def known_passwords() -> list[str]:
    """Unique, non-empty saved passwords — used to seed a bulk-change attempt bank."""
    async with _lock:
        seen: list[str] = []
        for v in _read().values():
            if v and v not in seen:
                seen.append(v)
        return seen


async def count() -> int:
    async with _lock:
        return len([v for v in _read().values() if v])
