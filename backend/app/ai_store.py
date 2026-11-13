"""Local-only AI provider settings (Vercel AI Gateway or OpenRouter).

The key is entered in the dashboard, never in .env, and lives next to the
Telegram session files:

    <SESSIONS_DIR>/ai_gateway.json -> {"api_key": "...", "provider": "...", "model": "..."}

It never leaves this machine except as the Authorization header on requests to
the selected provider.
"""
from __future__ import annotations
import asyncio
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from .config import settings

DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731"
DEFAULT_TARGET = "@folkapp_bot"
DEFAULT_MIN_TURNS = 4
DEFAULT_MAX_TURNS = 10

PROVIDER_VERCEL = "vercel"
PROVIDER_OPENROUTER = "openrouter"
PROVIDER_BASES = {
    PROVIDER_VERCEL: "https://ai-gateway.vercel.sh/v1",
    PROVIDER_OPENROUTER: "https://openrouter.ai/api/v1",
}
PROVIDER_LABELS = {
    PROVIDER_VERCEL: "Vercel AI Gateway",
    PROVIDER_OPENROUTER: "OpenRouter",
}


def detect_provider(api_key: str | None) -> str | None:
    key = (api_key or "").strip().lower()
    if not key:
        return None
    if key.startswith("sk-or-"):
        return PROVIDER_OPENROUTER
    if key.startswith("vck_") or key.startswith("vercel_"):
        return PROVIDER_VERCEL
    return None


def provider_base(provider: str | None) -> str:
    return PROVIDER_BASES.get(provider or PROVIDER_VERCEL, PROVIDER_BASES[PROVIDER_VERCEL])


def _probe(api_key: str, provider: str, model: str) -> None:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 4,
        "reasoning": {"enabled": False},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if provider == PROVIDER_OPENROUTER:
        headers["HTTP-Referer"] = "http://localhost"
        headers["X-Title"] = "Multi TG Manager"
    req = urllib.request.Request(
        provider_base(provider) + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            response.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(body).get("error", {}).get("message") or body
        except Exception:
            message = body
        raise ValueError(f"HTTP {e.code}: {str(message)[:180]}")
    except Exception as e:
        raise ValueError(str(e)[:180])


async def validate_and_detect(api_key: str, model: str) -> tuple[str, str | None]:
    provider = detect_provider(api_key)
    if provider:
        return provider, None
    errors = []
    for candidate in (PROVIDER_OPENROUTER, PROVIDER_VERCEL):
        try:
            await asyncio.to_thread(_probe, api_key, candidate, model)
            return candidate, errors[-1] if errors else None
        except Exception as e:
            errors.append(f"{PROVIDER_LABELS[candidate]}: {e}")
    return PROVIDER_VERCEL, "Could not verify the key automatically. " + " | ".join(errors)

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
    provider = data.get("provider") or detect_provider(key) or PROVIDER_VERCEL
    model = str(data.get("model") or DEFAULT_MODEL)
    return {
        "api_key": key,
        "has_key": bool(key),
        "key_preview": ("**** " + key[-4:]) if len(key) >= 4 else ("****" if key else ""),
        "provider": provider,
        "provider_label": PROVIDER_LABELS.get(provider, "Vercel AI Gateway"),
        "base_url": str(data.get("base_url") or provider_base(provider)),
        "model": model,
        "target": str(data.get("target") or DEFAULT_TARGET),
        "min_turns": min_turns,
        "max_turns": max_turns,
    }


async def save_settings(api_key: str | None = None, model: str | None = None,
                        target: str | None = None, min_turns: int | None = None,
                        max_turns: int | None = None, provider: str | None = None,
                        base_url: str | None = None) -> dict:
    async with _lock:
        data = _read()
        if api_key is not None:
            key = api_key.strip()
            if key:
                data["api_key"] = key
                chosen = provider or detect_provider(key) or PROVIDER_VERCEL
                data["provider"] = chosen
                data["base_url"] = base_url or provider_base(chosen)
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
        data.pop("provider", None)
        data.pop("base_url", None)
        _write(data)
    return await get_settings()
