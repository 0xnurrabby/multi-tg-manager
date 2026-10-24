"""Local-only Vercel AI Gateway settings for the AI chat section.

The key is entered in the dashboard, never in .env, and lives next to the
Telegram session files:

    <SESSIONS_DIR>/ai_gateway.json -> {"api_key": "...", "model": "...", "target": "..."}

It never leaves this machine except as the Authorization header on requests to
the Vercel AI Gateway.
"""
from __future__ import annotations
import asyncio
import json
import os
from pathlib import Path

from .config import settings

DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731"
DEFAULT_TARGET = "@folkapp_bot"
DEFAULT_MIN_TURNS = 4
DEFAULT_MAX_TURNS = 10

_lock = asyncio.Lock()


def _path() -> Path:
    return settings.sessions_path / "ai_gateway.json"


def _read() -> dict:
    p = _path()
    try:
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8") or "{}")
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _write(data: dict):
    p = _path()
    tmp = p.parent / (p.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


async def get_settings() -> dict:
    async with _lock:
        data = _read()
    key = str(data.get("api_key") or "")
    try:
        min_turns = int(data.get("min_turns") or DEFAULT_MIN_TURNS)
    except (TypeError, ValueError):
        min_turns = DEFAULT_MIN_TURNS
    try:
        max_turns = int(data.get("max_turns") or DEFAULT_MAX_TURNS)
    except (TypeError, ValueError):
        max_turns = DEFAULT_MAX_TURNS
    min_turns = max(1, min(min_turns, 500))
    max_turns = max(min_turns, min(max_turns, 500))
    return {
        "api_key": key,
        "has_key": bool(key),
        "key_preview": ("**** " + key[-4:]) if len(key) >= 4 else ("****" if key else ""),
        "model": str(data.get("model") or DEFAULT_MODEL),
        "target": str(data.get("target") or DEFAULT_TARGET),
        "min_turns": min_turns,
        "max_turns": max_turns,
    }


async def save_settings(api_key: str | None = None, model: str | None = None,
                        target: str | None = None, min_turns: int | None = None,
                        max_turns: int | None = None) -> dict:
    async with _lock:
        data = _read()
        if api_key is not None:
            key = api_key.strip()
            if key:
                data["api_key"] = key
        if model is not None and model.strip():
            data["model"] = model.strip()
        if target is not None and target.strip():
            data["target"] = target.strip()
        if min_turns is not None:
            data["min_turns"] = str(max(1, min(int(min_turns), 500)))
        if max_turns is not None:
            data["max_turns"] = str(max(1, min(int(max_turns), 500)))
        _write(data)
    return await get_settings()


async def clear_key() -> dict:
    async with _lock:
        data = _read()
        data.pop("api_key", None)
        _write(data)
    return await get_settings()
