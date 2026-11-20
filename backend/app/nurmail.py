"""Minimal NurMail API v1 client (server-side only).

The key is stored in the app settings (or backend/.env) and never leaves the
backend. Only used to create a mailbox and read the verification code Telegram
sends to it.
"""
from __future__ import annotations

import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE_URL = "https://nurmail.fun/api/v1"


class NurMailError(Exception):
    pass


class NurMail:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL):
        self.api_key = (api_key or "").strip()
        self.base_url = (base_url or DEFAULT_BASE_URL).strip().rstrip("/")

    # -- internals ---------------------------------------------------------
    def _request(self, method: str, path: str, body: dict | None = None, timeout: int = 30) -> dict:
        if not self.api_key:
            raise NurMailError("NurMail API key is not set")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "MultiTGManager/1.0 (NurMail API client)")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                raw = res.read().decode("utf-8", errors="replace")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            try:
                err = (json.loads(raw) or {}).get("error") or {}
            except Exception:
                err = {}
            raise NurMailError(err.get("message") or f"NurMail HTTP {e.code}") from None
        except Exception as e:
            raise NurMailError(str(e)) from None

    # -- public ------------------------------------------------------------
    def me(self) -> dict:
        return self._request("GET", "/me")

    def create_mailbox(self, name: str | None = None, ttl: int = 604800) -> dict:
        payload = {"ttl": int(ttl), "name": name or ("tg" + secrets.token_hex(4))}
        return self._request("POST", "/mailboxes", payload)

    def delete_mailbox(self, address: str) -> dict:
        return self._request("DELETE", f"/mailboxes/{urllib.parse.quote(address)}")

    def has_mailbox(self, address: str) -> bool:
        data = self._request("GET", "/mailboxes")
        target = (address or "").strip().lower()
        return any(
            (m.get("address") or "").strip().lower() == target
            for m in (data.get("mailboxes") or [])
        )

    def latest_message_id(self, address: str) -> int:
        """Highest message id in the mailbox, used as `since` for the next OTP."""
        data = self._request(
            "GET", f"/mailboxes/{urllib.parse.quote(address)}/messages?limit=1",
        )
        return int((data or {}).get("nextSince") or 0)

    def wait_otp(self, address: str, wait: int = 15, timeout: int = 60, since: int = 0) -> str:
        deadline = time.time() + max(15, int(timeout))
        wait = max(0, min(15, int(wait)))
        encoded = urllib.parse.quote(address)
        while time.time() < deadline:
            try:
                data = self._request(
                    "GET",
                    f"/mailboxes/{encoded}/otp?wait={wait}&since={int(since)}",
                    timeout=wait + 20,
                )
            except NurMailError as e:
                text = str(e).lower()
                if "otp" in text or "not found" in text or "no verification" in text:
                    continue
                raise
            code = str((data or {}).get("code") or "").strip()
            if code:
                return code
        raise NurMailError("No verification code arrived in the mailbox in time")
