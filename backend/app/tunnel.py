"""Auto-start a Cloudflare quick tunnel for the local dashboard."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("tunnel")

LOCAL_URL = "http://localhost:8000"
DOWNLOAD_URL = (
    "https://github.com/cloudflare/cloudflared/releases/latest/download/"
    "cloudflared-windows-amd64.exe"
)
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.I)


def _kill_stale_local_tunnels():
    if not sys.platform.startswith("win"):
        return
    script = (
        "$p = Get-CimInstance Win32_Process -Filter \"Name = 'cloudflared.exe'\" | "
        "Where-Object { $_.CommandLine -like '*--url http://localhost:8000*' } | "
        "Select-Object -ExpandProperty ProcessId; "
        "$p | ConvertTo-Json -Compress"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, text=True, timeout=20,
        )
        raw = (out.stdout or "").strip()
        if not raw:
            return
        data = json.loads(raw)
        pids = [data] if isinstance(data, int) else list(data or [])
        for pid in pids:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True, timeout=10,
            )
            log.info("cleaned stale cloudflared pid=%s", pid)
    except Exception as e:
        log.warning("stale tunnel cleanup failed: %s", e)


class TunnelManager:
    def __init__(self):
        self._proc = None
        self._task = None
        self._state = {
            "status": "off",
            "url": None,
            "error": "",
            "started_at": None,
            "local_url": LOCAL_URL,
        }

    def snapshot(self) -> dict:
        return dict(self._state)

    async def start(self):
        if self._task and not self._task.done():
            return
        self._state.update(status="starting", error="", url=None)
        self._task = asyncio.create_task(self._run(), name="cloudflare-tunnel")

    async def stop(self):
        proc = self._proc
        self._proc = None
        if proc and proc.returncode is None:
            try:
                proc.terminate()
            except Exception:
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=6)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        task = self._task
        self._task = None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except Exception:
                pass
        self._state.update(status="off", url=None)

    def _binary(self) -> str | None:
        found = shutil.which("cloudflared")
        if found:
            return found
        if sys.platform.startswith("win"):
            local = Path(__file__).resolve().parent.parent / "bin" / "cloudflared.exe"
            return str(local)
        return None

    async def _ensure_binary(self) -> str:
        exe = self._binary()
        if not exe:
            raise RuntimeError("cloudflared is not installed")
        path = Path(exe)
        if path.exists():
            return exe
        if not sys.platform.startswith("win"):
            raise RuntimeError("cloudflared is not installed")
        path.parent.mkdir(parents=True, exist_ok=True)
        self._state.update(status="downloading", error="")
        log.info("downloading cloudflared...")
        tmp = path.with_suffix(".part")

        def download():
            urllib.request.urlretrieve(DOWNLOAD_URL, tmp)
            tmp.replace(path)

        await asyncio.to_thread(download)
        return str(path)

    async def _run(self):
        proc = None
        try:
            await asyncio.to_thread(_kill_stale_local_tunnels)
            exe = await self._ensure_binary()
            self._state.update(status="starting", error="")
            proc = await asyncio.create_subprocess_exec(
                exe,
                "tunnel",
                "--url",
                LOCAL_URL,
                "--no-autoupdate",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            self._proc = proc
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                match = URL_RE.search(text)
                if match and not self._state.get("url"):
                    self._state.update(
                        status="running",
                        url=match.group(0),
                        error="",
                        started_at=datetime.now(timezone.utc).isoformat(),
                    )
                    log.info("Cloudflare tunnel: %s", match.group(0))
            code = await proc.wait()
            if self._state.get("status") not in ("off", "error"):
                self._state.update(
                    status="error",
                    error=f"cloudflared exited (code {code})",
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("tunnel failed: %s", e)
            self._state.update(status="error", error=str(e)[:300])
        finally:
            if proc and proc.returncode is None:
                try:
                    proc.terminate()
                except Exception:
                    pass
            self._proc = None


tunnel_manager = TunnelManager()
