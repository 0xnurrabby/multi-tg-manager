from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.tl.functions.account import UpdateProfileRequest
from telethon.tl.functions.photos import UploadProfilePhotoRequest
from telethon.errors import FloodWaitError
import tempfile, os, json

from ..db import get_db
from ..models import Account
from ..schemas import BulkProfileIn
from ..tg_manager import manager
from ..utils import jitter_delay, friendly_error

router = APIRouter(prefix="/api/bulk", tags=["bulk"])


@router.post("/profile")
async def bulk_profile(body: BulkProfileIn, db: AsyncSession = Depends(get_db)):
    """Either:
       - same first_name/last_name/bio for everyone (with optional number suffix)
       - OR per_account: { account_id: {first_name, last_name, bio} } (from CSV import)
    """
    res = await db.execute(select(Account).where(Account.id.in_(body.account_ids)))
    accounts = {a.id: a for a in res.scalars().all()}
    success, failed, skipped = 0, 0, 0
    results = []
    n = body.start_number
    for idx, aid in enumerate(body.account_ids):
        acc = accounts.get(aid)
        if not acc:
            skipped += 1
            results.append({"id": aid, "phone": "?", "status": "skipped", "detail": "not found"})
            continue
        cli = manager.get(acc.id)
        if not cli:
            skipped += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "skipped", "detail": "not connected"})
            continue
        try:
            per = body.per_account.get(str(acc.id)) if body.per_account else None
            kw = {}
            fn = (per or {}).get("first_name") if per else body.first_name
            ln = (per or {}).get("last_name") if per else body.last_name
            bio = (per or {}).get("bio") if per else body.bio
            if fn is not None:
                if body.append_number and not per:
                    fn = f"{fn} {n}"
                kw["first_name"] = fn
                acc.first_name = fn
            if ln is not None:
                if body.append_number and not per:
                    ln = f"{ln} {n}"
                kw["last_name"] = ln
                acc.last_name = ln
            if bio is not None:
                if len(bio) > 70:
                    raise ValueError("Bio max 70 chars")
                kw["about"] = bio
                acc.bio = bio
            if kw:
                await cli(UpdateProfileRequest(**kw))
            await db.commit()
            success += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "ok"})
            n += 1
        except Exception as e:
            failed += 1
            results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
        if idx < len(body.account_ids) - 1:
            await jitter_delay()
    return {"success": success, "failed": failed, "skipped": skipped, "results": results}


@router.post("/photo")
async def bulk_photo(
    account_ids: str = Form(...),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """One photo per account in the order given.
    - If len(files) >= len(accounts): first N files used, rest ignored.
    - If len(files) <  len(accounts): only first len(files) accounts updated, others skipped.
    """
    ids = [int(x) for x in account_ids.split(",") if x.strip()]
    res = await db.execute(select(Account).where(Account.id.in_(ids)))
    by_id = {a.id: a for a in res.scalars().all()}
    accounts = [by_id[i] for i in ids if i in by_id]

    # write all files to disk first
    tmp_paths: list[str] = []
    try:
        for f in files:
            data = await f.read()
            suffix = os.path.splitext(f.filename or "photo.jpg")[1] or ".jpg"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(data); tmp_paths.append(tmp.name)

        success, failed, skipped = 0, 0, 0
        results = []
        for idx, acc in enumerate(accounts):
            if idx >= len(tmp_paths):
                skipped += 1
                results.append({"id": acc.id, "phone": acc.phone, "status": "skipped",
                                "detail": f"no photo at index {idx + 1}"})
                continue
            cli = manager.get(acc.id)
            if not cli:
                skipped += 1
                results.append({"id": acc.id, "phone": acc.phone, "status": "skipped", "detail": "not connected"})
                continue
            try:
                up = await cli.upload_file(tmp_paths[idx])
                await cli(UploadProfilePhotoRequest(file=up))
                success += 1
                results.append({"id": acc.id, "phone": acc.phone, "status": "ok"})
            except Exception as e:
                failed += 1
                results.append({"id": acc.id, "phone": acc.phone, "status": "failed", "detail": friendly_error(e)})
            if idx < len(accounts) - 1:
                await jitter_delay()
    finally:
        for p in tmp_paths:
            try: os.unlink(p)
            except Exception: pass
    return {"success": success, "failed": failed, "skipped": skipped, "results": results}
