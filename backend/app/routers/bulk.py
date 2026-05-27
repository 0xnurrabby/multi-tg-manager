from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.functions.account import UpdateProfileRequest
from telethon.tl.functions.photos import UploadProfilePhotoRequest
from telethon.errors import FloodWaitError
import tempfile, os

from ..db import get_db
from ..models import Account
from ..schemas import BulkProfileIn
from ..tg_manager import manager
from ..utils import jitter_delay, friendly_error

router = APIRouter(prefix="/api/bulk", tags=["bulk"])


@router.post("/profile")
async def bulk_profile(body: BulkProfileIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = res.scalars().all()
    success, failed, skipped = 0, 0, 0
    results = []
    n = body.start_number
    for idx, acc in enumerate(accounts):
        cli = manager.get(acc.id)
        if not cli:
            skipped += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "skipped", "detail": "not connected"})
            continue
        try:
            kw = {}
            if body.first_name is not None:
                fn = body.first_name
                if body.append_number:
                    fn = f"{fn} {n}"
                kw["first_name"] = fn
                acc.first_name = fn
            if body.last_name is not None:
                ln = body.last_name
                if body.append_number:
                    ln = f"{ln} {n}"
                kw["last_name"] = ln
                acc.last_name = ln
            if body.bio is not None:
                if len(body.bio) > 70:
                    raise ValueError("Bio max 70 chars")
                kw["about"] = body.bio
                acc.bio = body.bio
            if kw:
                await cli(UpdateProfileRequest(**kw))
            await db.commit()
            success += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "ok"})
            n += 1
        except Exception as e:
            failed += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
        if idx < len(accounts) - 1:
            await jitter_delay()
    return {"success": success, "failed": failed, "skipped": skipped, "results": results}


@router.post("/photo")
async def bulk_photo(
    account_ids: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    ids = [int(x) for x in account_ids.split(",") if x.strip()]
    res = await db.execute(select(Account).where(Account.id.in_(ids)))
    accounts = res.scalars().all()
    data = await file.read()
    suffix = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data); tmp_path = tmp.name

    success, failed, skipped = 0, 0, 0
    results = []
    try:
        for idx, acc in enumerate(accounts):
            cli = manager.get(acc.id)
            if not cli:
                skipped += 1
                results.append({"id": acc.id, "phone": acc.phone, "status": "skipped", "detail": "not connected"})
                continue
            try:
                up = await cli.upload_file(tmp_path)
                await cli(UploadProfilePhotoRequest(file=up))
                success += 1
                results.append({"id": acc.id, "phone": acc.phone, "status": "ok"})
            except Exception as e:
                failed += 1
                results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
            if idx < len(accounts) - 1:
                await jitter_delay()
    finally:
        try: os.unlink(tmp_path)
        except Exception: pass
    return {"success": success, "failed": failed, "skipped": skipped, "results": results}
