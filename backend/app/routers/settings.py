from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import json
from datetime import datetime

from ..db import get_db
from ..models import AppSetting, Account
from ..schemas import SettingsIn, SettingsOut
from ..config import settings as env_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULTS = {
    "rate_min": "2",
    "rate_max": "4",
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
    return SettingsOut(
        rate_min=float(cur["rate_min"]),
        rate_max=float(cur["rate_max"]),
        sessions_dir=cur["sessions_dir"],
        auto_reconnect=cur["auto_reconnect"] == "true",
        notification_sound=cur["notification_sound"] == "true",
    )


@router.put("", response_model=SettingsOut)
async def update_settings(body: SettingsIn, db: AsyncSession = Depends(get_db)):
    payload = {
        "rate_min": str(body.rate_min),
        "rate_max": str(body.rate_max),
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
    # apply rate to env_settings live
    env_settings.RATE_MIN = body.rate_min
    env_settings.RATE_MAX = body.rate_max
    return await get_settings(db)


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
