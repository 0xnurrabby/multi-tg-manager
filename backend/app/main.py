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
from .ai_chat import ai_manager
from .tunnel import tunnel_manager
from .auth import router as auth_router, require_auth
from .routers import accounts, profile, security, groups, messaging, settings as settings_router, bulk, ai as ai_router

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
    # Do not make the web UI wait for 300 Telegram clients. Serve immediately
    # and connect accounts in the background.
    load_task = asyncio.create_task(manager.startup_load_all())
    await tunnel_manager.start()

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
        if load_task and not load_task.done():
            load_task.cancel()
        await tunnel_manager.stop()
        await ai_manager.shutdown()
        await manager.shutdown()


app = FastAPI(title="Multi TG Manager", lifespan=lifespan)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if request.url.scheme == "https" or proto == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


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


@app.get("/api/tunnel", dependencies=[Depends(require_auth)])
async def tunnel_info():
    return tunnel_manager.snapshot()


# all data routers require auth
PROTECTED_DEPS = [Depends(require_auth)]
app.include_router(accounts.router,        dependencies=PROTECTED_DEPS)
app.include_router(profile.router,         dependencies=PROTECTED_DEPS)
app.include_router(security.router,        dependencies=PROTECTED_DEPS)
app.include_router(groups.router,          dependencies=PROTECTED_DEPS)
app.include_router(messaging.router,       dependencies=PROTECTED_DEPS)
app.include_router(settings_router.router, dependencies=PROTECTED_DEPS)
app.include_router(bulk.router,            dependencies=PROTECTED_DEPS)
app.include_router(ai_router.router,       dependencies=PROTECTED_DEPS)


# Any /api/* path that didn't match a real route above returns a clean JSON 404
# for ANY method. Registered before the GET-only SPA fallback so an unmatched
# POST/PUT/DELETE (e.g. calling a new endpoint against a stale server) surfaces a
# proper "Not Found" instead of a confusing "405 Method Not Allowed".
@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def api_not_found(rest: str):
    return JSONResponse({"detail": "Not Found"}, status_code=404)


# ---- serve built frontend (single-port mode) ----
# `start.bat` builds the frontend into backend/static/. If that folder exists, serve it.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

if STATIC_DIR.is_dir():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    # Always revalidate the app shell so a rebuilt frontend is picked up on a
    # normal refresh. Hashed assets under /assets keep their long cache.
    NO_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}

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
            return FileResponse(str(index), headers=NO_CACHE)
        return JSONResponse({"detail": "Frontend not built. Run start.bat."}, status_code=503)
else:
    @app.get("/")
    async def no_static():
        return JSONResponse(
            {"detail": "Frontend not built. Run `npm run build` in frontend/ or use start.bat."},
            status_code=503,
        )
