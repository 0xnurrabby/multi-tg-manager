from contextlib import asynccontextmanager
import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import init_db
from .tg_manager import manager
from .auth import router as auth_router, require_auth
from .routers import accounts, profile, security, groups, messaging, settings as settings_router, bulk

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # validate critical env
    if not settings.APP_PASSWORD:
        log.warning("APP_PASSWORD is empty — set it in backend/.env!")
    if not settings.SESSION_SECRET or len(settings.SESSION_SECRET) < 16:
        log.warning("SESSION_SECRET is missing or too short — set it in backend/.env!")
    await init_db()
    manager.set_loop(asyncio.get_event_loop())
    await manager.startup_load_all()

    async def status_loop():
        while True:
            try:
                await manager.refresh_status_all()
            except Exception as e:
                log.warning("status refresh: %s", e)
            await asyncio.sleep(30)
    task = asyncio.create_task(status_loop())
    try:
        yield
    finally:
        task.cancel()
        await manager.shutdown()


app = FastAPI(title="Multi TG Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.ALLOWED_ORIGIN, "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# auth endpoints (public)
app.include_router(auth_router)


@app.get("/api/health")
async def health():
    return {"ok": True, "api_id_set": bool(settings.TG_API_ID), "clients": len(manager._clients)}


# all data routers require auth
PROTECTED_DEPS = [Depends(require_auth)]
app.include_router(accounts.router,        dependencies=PROTECTED_DEPS)
app.include_router(profile.router,         dependencies=PROTECTED_DEPS)
app.include_router(security.router,        dependencies=PROTECTED_DEPS)
app.include_router(groups.router,          dependencies=PROTECTED_DEPS)
app.include_router(messaging.router,       dependencies=PROTECTED_DEPS)
app.include_router(settings_router.router, dependencies=PROTECTED_DEPS)
app.include_router(bulk.router,            dependencies=PROTECTED_DEPS)


# ---- serve built frontend (single-port mode) ----
# `start.bat` builds the frontend into backend/static/. If that folder exists, serve it.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

if STATIC_DIR.is_dir():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str, request: Request):
        # never intercept the api
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # try a real file first (favicon, etc.)
        candidate = STATIC_DIR / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        index = STATIC_DIR / "index.html"
        if index.is_file():
            return FileResponse(str(index))
        return JSONResponse({"detail": "Frontend not built. Run start.bat."}, status_code=503)
else:
    @app.get("/")
    async def no_static():
        return JSONResponse(
            {"detail": "Frontend not built. Run `npm run build` in frontend/ or use start.bat."},
            status_code=503,
        )
