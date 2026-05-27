"""Manage one Telethon client per account, with 777000 listeners."""
from __future__ import annotations
import asyncio
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from telethon import TelegramClient, events
from telethon.errors import (
    AuthKeyUnregisteredError,
    UserDeactivatedBanError,
    UserDeactivatedError,
    RPCError,
)
from telethon.tl.functions.account import UpdateProfileRequest, UpdateUsernameRequest, GetAuthorizationsRequest, ResetAuthorizationRequest, ResetAuthorizationsRequest
from telethon.tl.functions.photos import UploadProfilePhotoRequest
from telethon.tl.types import User as TgUser
from sqlalchemy import select

from .config import settings
from .db import AsyncSessionLocal
from .models import Account, SecurityMessage

log = logging.getLogger("tg_manager")

SERVICE_ID = 777000


def classify_777000(text: str) -> str:
    low = text.lower()
    if re.search(r"login code|\b\d{5}\b", low):
        return "login_code"
    if "new login" in low or "new device" in low:
        return "new_login"
    if "two-step" in low or "password" in low:
        return "2fa_change"
    if "delete" in low or "deactivation" in low:
        return "account_deletion"
    return "unknown"


class TgClientManager:
    def __init__(self):
        self._clients: dict[int, TelegramClient] = {}  # account_id -> client
        self._lock = asyncio.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._new_msg_callbacks: list = []

    def set_loop(self, loop):
        self._loop = loop

    # ---------- helpers ----------
    def _session_path(self, phone: str) -> str:
        safe = re.sub(r"[^0-9]", "", phone)
        return str(settings.sessions_path / f"acc_{safe}")

    def get(self, account_id: int) -> Optional[TelegramClient]:
        return self._clients.get(account_id)

    async def all_clients(self) -> dict[int, TelegramClient]:
        return dict(self._clients)

    # ---------- lifecycle ----------
    async def startup_load_all(self):
        """On boot, start clients for every previously-authorized account."""
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(Account))
            accounts = res.scalars().all()
        for acc in accounts:
            try:
                await self.start_client(acc)
            except Exception as e:
                log.warning("Failed to start client for %s: %s", acc.phone, e)

    async def shutdown(self):
        for cli in list(self._clients.values()):
            try:
                await cli.disconnect()
            except Exception:
                pass
        self._clients.clear()

    async def start_client(self, acc: Account) -> TelegramClient:
        async with self._lock:
            if acc.id in self._clients:
                return self._clients[acc.id]
            cli = TelegramClient(self._session_path(acc.phone), settings.TG_API_ID, settings.TG_API_HASH)
            await cli.connect()
            if not await cli.is_user_authorized():
                await cli.disconnect()
                await self._set_status(acc.id, "disconnected")
                raise RuntimeError("not authorized")
            self._clients[acc.id] = cli
            self._attach_listener(acc.id, cli)
            await self._set_status(acc.id, "connected")
            # sync profile
            try:
                me = await cli.get_me()
                await self._sync_profile(acc.id, me)
            except Exception:
                pass
            return cli

    async def stop_client(self, account_id: int):
        async with self._lock:
            cli = self._clients.pop(account_id, None)
        if cli:
            try:
                await cli.disconnect()
            except Exception:
                pass

    async def remove_account(self, account_id: int, delete_session_file: bool = True):
        cli = self._clients.get(account_id)
        if cli:
            await self.stop_client(account_id)
        if delete_session_file:
            async with AsyncSessionLocal() as db:
                acc = await db.get(Account, account_id)
                if acc:
                    p = Path(self._session_path(acc.phone) + ".session")
                    try:
                        if p.exists():
                            p.unlink()
                    except Exception:
                        pass

    # ---------- auth flow ----------
    async def send_code(self, phone: str) -> str:
        cli = TelegramClient(self._session_path(phone), settings.TG_API_ID, settings.TG_API_HASH)
        await cli.connect()
        sent = await cli.send_code_request(phone)
        await cli.disconnect()
        return sent.phone_code_hash

    async def sign_in(self, phone: str, code: str, phone_code_hash: str, password: Optional[str] = None) -> TgUser:
        cli = TelegramClient(self._session_path(phone), settings.TG_API_ID, settings.TG_API_HASH)
        await cli.connect()
        try:
            await cli.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except Exception as e:
            from telethon.errors import SessionPasswordNeededError
            if isinstance(e, SessionPasswordNeededError):
                if not password:
                    await cli.disconnect()
                    raise
                await cli.sign_in(password=password)
            else:
                await cli.disconnect()
                raise
        me = await cli.get_me()
        await cli.disconnect()
        return me

    # ---------- listener ----------
    def _attach_listener(self, account_id: int, cli: TelegramClient):
        @cli.on(events.NewMessage(from_users=SERVICE_ID))
        async def _handler(event):
            try:
                text = event.message.message or ""
                msg_id = event.message.id
                m_type = classify_777000(text)
                async with AsyncSessionLocal() as db:
                    sm = SecurityMessage(
                        account_id=account_id,
                        tg_msg_id=msg_id,
                        message_text=text,
                        type=m_type,
                        is_read=False,
                        received_at=datetime.utcnow(),
                    )
                    db.add(sm)
                    await db.commit()
                    await db.refresh(sm)
                # notify pub/sub
                for cb in list(self._new_msg_callbacks):
                    try:
                        cb({
                            "id": sm.id,
                            "account_id": account_id,
                            "type": m_type,
                            "message_text": text,
                            "received_at": sm.received_at.isoformat(),
                        })
                    except Exception:
                        pass
            except Exception as e:
                log.exception("777000 handler failed: %s", e)

    def subscribe_new_messages(self, cb):
        self._new_msg_callbacks.append(cb)

    def unsubscribe_new_messages(self, cb):
        try:
            self._new_msg_callbacks.remove(cb)
        except ValueError:
            pass

    # ---------- DB helpers ----------
    async def _set_status(self, account_id: int, status: str):
        async with AsyncSessionLocal() as db:
            acc = await db.get(Account, account_id)
            if acc:
                acc.status = status
                await db.commit()

    async def _sync_profile(self, account_id: int, me: TgUser):
        async with AsyncSessionLocal() as db:
            acc = await db.get(Account, account_id)
            if not acc:
                return
            acc.first_name = me.first_name or ""
            acc.last_name = me.last_name or ""
            acc.username = me.username or ""
            acc.tg_user_id = me.id
            # 2FA detection
            try:
                cli = self._clients.get(account_id)
                if cli:
                    from telethon.tl.functions.account import GetPasswordRequest
                    pw = await cli(GetPasswordRequest())
                    acc.has_2fa = bool(pw.has_password)
            except Exception:
                pass
            await db.commit()

    async def refresh_status_all(self):
        for aid, cli in list(self._clients.items()):
            try:
                if not cli.is_connected():
                    await cli.connect()
                ok = await cli.is_user_authorized()
                await self._set_status(aid, "connected" if ok else "disconnected")
            except (AuthKeyUnregisteredError, UserDeactivatedBanError, UserDeactivatedError):
                await self._set_status(aid, "banned")
            except Exception:
                await self._set_status(aid, "disconnected")


manager = TgClientManager()
