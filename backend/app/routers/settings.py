from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio
import json
import os
import re
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from ..db import get_db
from ..models import AppSetting, Account
from ..schemas import SettingsIn, SettingsOut, AiKeyIn
from .. import ai_store
from ..config import settings as env_settings
from ..tg_manager import manager

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULTS = {
    "rate_min": "0.7",
    "rate_max": "1.5",
    "concurrency": "8",
    "sessions_dir": env_settings.SESSIONS_DIR,
    "auto_reconnect": "true",
    "notification_sound": "true",
}


async def _read_all(db: AsyncSession) -> dict[str, str]:
    res = await db.execute(select(AppSetting))
    rows = res.scalars().all()
    cur = {r.key: r.value for r in rows}
    for k, v in DEFAULTS.items():
        cur.setdefault(k, v)
    return cur


@router.get("", response_model=SettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)):
    cur = await _read_all(db)
    try:
        conc = int(float(cur.get("concurrency", "5")))
    except (TypeError, ValueError):
        conc = 5
    return SettingsOut(
        rate_min=float(cur["rate_min"]),
        rate_max=float(cur["rate_max"]),
        concurrency=max(1, conc),
        sessions_dir=cur["sessions_dir"],
        auto_reconnect=cur["auto_reconnect"] == "true",
        notification_sound=cur["notification_sound"] == "true",
    )


@router.put("", response_model=SettingsOut)
async def update_settings(body: SettingsIn, db: AsyncSession = Depends(get_db)):
    conc = max(1, int(body.concurrency or 5))
    payload = {
        "rate_min": str(body.rate_min),
        "rate_max": str(body.rate_max),
        "concurrency": str(conc),
        "sessions_dir": body.sessions_dir,
        "auto_reconnect": "true" if body.auto_reconnect else "false",
        "notification_sound": "true" if body.notification_sound else "false",
    }
    res = await db.execute(select(AppSetting))
    existing = {r.key: r for r in res.scalars().all()}
    for k, v in payload.items():
        if k in existing:
            existing[k].value = v
        else:
            db.add(AppSetting(key=k, value=v))
    await db.commit()
    # apply rate + concurrency to env_settings live (no restart needed)
    env_settings.RATE_MIN = body.rate_min
    env_settings.RATE_MAX = body.rate_max
    env_settings.CONCURRENCY = conc
    return await get_settings(db)


def _safe_remove(path: str):
    try:
        os.unlink(path)
    except OSError:
        pass


def _session_snapshot(source: Path, target: Path):
    try:
        with sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True) as src:
            with sqlite3.connect(target) as dst:
                src.backup(dst)
    except Exception:
        shutil.copy2(source, target)


def _build_session_zip(accounts: list[Account]) -> tuple[str, int]:
    tmp = tempfile.NamedTemporaryFile(prefix="telegram-sessions-", suffix=".zip", delete=False)
    tmp_path = tmp.name
    tmp.close()
    manifest = []
    try:
        with tempfile.TemporaryDirectory(prefix="telegram-session-snap-") as work, \
                zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for acc in accounts:
                base = manager._session_path_for_account(acc)
                source = Path(base + ".session")
                if not source.exists():
                    continue
                safe = re.sub(r"[^0-9A-Za-z_.-]", "_", acc.phone or str(acc.id))
                arcname = f"{acc.id}_{safe}.session"
                snap = Path(work) / f"{acc.id}.session"
                try:
                    _session_snapshot(source, snap)
                    archive.write(snap, arcname)
                except Exception:
                    continue
                manifest.append({
                    "account_id": acc.id,
                    "phone": acc.phone,
                    "name": (f"{acc.first_name or ''} {acc.last_name or ''}".strip() or acc.phone),
                    "username": acc.username or "",
                    "status": acc.status,
                    "has_2fa": bool(acc.has_2fa),
                    "session_file": arcname,
                })
            if not manifest:
                raise RuntimeError("No session files found")
            archive.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
            archive.writestr("README.txt", (
                "Telegram MTProto session export.\n\n"
                "These files grant full access to the Telegram accounts. Keep this archive private.\n"
                "Import only into a trusted Telethon/MTProto-compatible client using the same API credentials as this manager.\n"
                "The official Telegram app cannot import .session files.\n"
                "This export is a read-only snapshot: no account was logged out or deleted.\n"
            ))
        return tmp_path, len(manifest)
    except Exception:
        _safe_remove(tmp_path)
        raise


@router.get("/sessions/export")
async def export_sessions(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).order_by(Account.id))
    accounts = list(res.scalars().all())
    try:
        path, count = await asyncio.to_thread(_build_session_zip, accounts)
    except Exception as e:
        raise HTTPException(400, str(e) or "Could not build session export")
    filename = f"telegram-sessions-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.zip"
    return FileResponse(
        path,
        media_type="application/zip",
        filename=filename,
        background=BackgroundTask(_safe_remove, path),
    )


def _public_ai_key(cfg: dict) -> dict:
    return {
        "has_key": bool(cfg.get("has_key")),
        "key_preview": cfg.get("key_preview") or "",
        "provider": cfg.get("provider") or "vercel",
        "provider_label": cfg.get("provider_label") or "Vercel AI Gateway",
        "base_url": cfg.get("base_url") or "",
        "model": cfg.get("model") or "",
    }


@router.get("/ai_key")
async def get_ai_key():
    cfg = await ai_store.get_settings()
    return _public_ai_key(cfg)


@router.put("/ai_key")
async def save_ai_key(body: AiKeyIn):
    key = (body.api_key or "").strip()
    if not key:
        raise HTTPException(400, "Paste an API key first")
    current = await ai_store.get_settings()
    model = (body.model or current.get("model") or ai_store.DEFAULT_MODEL).strip()
    provider, warning = await ai_store.validate_and_detect(key, model)
    cfg = await ai_store.save_settings(
        api_key=key,
        model=model,
        provider=provider,
        base_url=ai_store.provider_base(provider),
    )
    out = _public_ai_key(cfg)
    out["warning"] = warning or ""
    return out


@router.delete("/ai_key")
async def clear_ai_key():
    cfg = await ai_store.clear_key()
    return _public_ai_key(cfg)


@router.get("/export")
async def export_json(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account))
    accounts = res.scalars().all()
    out = []
    for a in accounts:
        out.append({
            "id": a.id, "phone": a.phone, "first_name": a.first_name,
            "last_name": a.last_name, "username": a.username, "bio": a.bio,
            "status": a.status, "has_2fa": a.has_2fa,
            "tg_user_id": a.tg_user_id, "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    return {
        "exported_at": datetime.utcnow().isoformat(),
        "count": len(out),
        "accounts": out,
    }
