@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Multi TG Manager
cd /d "%~dp0"

echo.
echo =============================================
echo   Multi TG Manager - launcher
echo =============================================
echo.

REM ---------- 1. Check Python ----------
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed or not on PATH.
  echo Install Python 3.10+ from https://python.org and re-run.
  pause & exit /b 1
)

REM ---------- 2. Check Node ----------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Install Node 18+ from https://nodejs.org and re-run.
  pause & exit /b 1
)

REM ---------- 3. Backend venv ----------
if not exist backend\.venv (
  echo [setup] Creating Python virtual environment...
  pushd backend
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create venv.
    popd & pause & exit /b 1
  )
  popd
)

REM ---------- 4. Install Python deps if needed ----------
if not exist backend\.venv\.installed (
  echo [setup] Installing Python dependencies (this may take 2-3 minutes)...
  pushd backend
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] pip install failed. See errors above.
    popd & pause & exit /b 1
  )
  echo done > .venv\.installed
  popd
)

REM ---------- 5. Generate .env if missing ----------
if not exist backend\.env (
  echo [setup] Generating backend\.env with a random SESSION_SECRET...
  pushd backend
  call .venv\Scripts\activate.bat
  for /f "delims=" %%s in ('python -c "import secrets; print(secrets.token_urlsafe(48))"') do set "SS=%%s"
  >  .env echo # Created by start.bat - edit the values you care about
  >> .env echo TG_API_ID=
  >> .env echo TG_API_HASH=
  >> .env echo SESSIONS_DIR=./sessions
  >> .env echo DB_URL=sqlite+aiosqlite:///./app.db
  >> .env echo RATE_MIN=2
  >> .env echo RATE_MAX=4
  >> .env echo ALLOWED_ORIGIN=http://localhost:5173
  >> .env echo APP_PASSWORD=change-me-to-a-long-strong-password
  >> .env echo SESSION_SECRET=!SS!
  >> .env echo SESSION_DAYS=14
  >> .env echo LOGIN_MAX_ATTEMPTS=5
  >> .env echo LOGIN_WINDOW_MIN=15
  popd
  echo.
  echo =============================================
  echo   FIRST-RUN SETUP COMPLETE
  echo =============================================
  echo   1. Open backend\.env in Notepad
  echo   2. Fill TG_API_ID and TG_API_HASH from https://my.telegram.org
  echo   3. Change APP_PASSWORD to a strong password
  echo   4. Save and re-run this start.bat
  echo =============================================
  notepad backend\.env
  pause & exit /b 0
)

REM ---------- 6. Frontend deps ----------
if not exist frontend\node_modules (
  echo [setup] Installing frontend dependencies (this may take 2-3 minutes)...
  pushd frontend
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    popd & pause & exit /b 1
  )
  popd
)

REM ---------- 7. Build frontend if missing or sources newer ----------
set "NEEDS_BUILD=0"
if not exist backend\static\index.html (
  set "NEEDS_BUILD=1"
) else (
  REM rebuild if any frontend source is newer than the built index.html
  for /f %%i in ('dir /b /s /a:-d "frontend\src\*" "frontend\index.html" "frontend\package.json" "frontend\vite.config.js" "frontend\tailwind.config.js" 2^>nul ^| findstr /v "node_modules"') do (
    xcopy /L /Y /D "%%i" "backend\static\__noop__" >nul 2>&1
    if not errorlevel 1 (
      for %%a in ("%%i") do for %%b in ("backend\static\index.html") do (
        if "%%~ta" GTR "%%~tb" set "NEEDS_BUILD=1"
      )
    )
  )
)
if "!NEEDS_BUILD!"=="1" (
  echo [build] Building frontend...
  pushd frontend
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    popd & pause & exit /b 1
  )
  popd
)

REM ---------- 8. Start backend (this window stays open and shows logs) ----------
echo.
echo =============================================
echo   Starting server on http://localhost:8000
echo   Close this window to stop.
echo =============================================
echo.

REM open browser after a short delay using a background helper
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:8000"

cd backend
call .venv\Scripts\activate.bat
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

endlocal
