@echo off
setlocal EnableExtensions
title Multi TG Manager
cd /d "%~dp0"

set "EXIT_PAUSE=1"

echo.
echo =============================================
echo   Multi TG Manager - launcher
echo =============================================
echo.

REM ---------- 1. Python + Node check ----------
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed or not on PATH.
  echo Install Python 3.10+ from https://python.org , tick "Add to PATH", then re-run.
  goto :END
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Install Node 18+ from https://nodejs.org and re-run.
  goto :END
)

REM ---------- 2. Backend venv ----------
if not exist "backend\.venv\Scripts\python.exe" (
  echo [setup] Creating Python virtual environment...
  pushd backend
  python -m venv .venv
  if errorlevel 1 ( popd & echo [ERROR] venv creation failed. & goto :END )
  popd
)

REM ---------- 3. Install Python deps ----------
if not exist "backend\.venv\Lib\site-packages\fastapi" (
  echo [setup] Installing Python dependencies (2-3 minutes)...
  pushd backend
  call ".venv\Scripts\activate.bat"
  python -m pip install --upgrade pip
  pip install -r requirements.txt
  if errorlevel 1 ( popd & echo [ERROR] pip install failed. & goto :END )
  popd
)

REM ---------- 4. .env from .env.example (preserves your edits) ----------
if not exist "backend\.env" (
  if not exist "backend\.env.example" (
    echo [ERROR] backend\.env.example is missing - cannot continue.
    goto :END
  )
  echo [setup] Creating backend\.env from .env.example...
  copy /Y "backend\.env.example" "backend\.env" >nul
  REM replace placeholder SESSION_SECRET with a real random one
  pushd backend
  call ".venv\Scripts\activate.bat"
  python -c "import secrets, pathlib; p=pathlib.Path('.env'); t=p.read_text(encoding='utf-8'); s='SESSION_SECRET='+secrets.token_urlsafe(48); import re; t=re.sub(r'SESSION_SECRET=.*', s, t, count=1); p.write_text(t, encoding='utf-8'); print('SESSION_SECRET randomized.')"
  popd
  echo.
  echo =============================================
  echo   FIRST-RUN SETUP - PLEASE VERIFY backend\.env
  echo =============================================
  echo   1. TG_API_ID    - filled?
  echo   2. TG_API_HASH  - filled?
  echo   3. APP_PASSWORD - strong (min 12 chars)?
  echo.
  echo   Save the file then close Notepad.
  echo   Re-run this start.bat to launch.
  echo =============================================
  start "" notepad "backend\.env"
  goto :END
)

REM ---------- 5. Frontend deps ----------
if not exist "frontend\node_modules" (
  echo [setup] Installing frontend dependencies (2-3 minutes)...
  pushd frontend
  call npm install
  if errorlevel 1 ( popd & echo [ERROR] npm install failed. & goto :END )
  popd
)

REM ---------- 6. Build frontend if not built ----------
if not exist "backend\static\index.html" (
  echo [build] Building frontend...
  pushd frontend
  call npm run build
  if errorlevel 1 ( popd & echo [ERROR] Frontend build failed. & goto :END )
  popd
)

REM ---------- 7. Open browser, then start server ----------
echo.
echo =============================================
echo   Starting server: http://localhost:8000
echo   Close this window to stop.
echo =============================================
echo.

start "" /b cmd /c "ping -n 5 127.0.0.1 >nul & start """" http://localhost:8000"

cd backend
call ".venv\Scripts\activate.bat"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
set "EXIT_PAUSE=0"

:END
if "%EXIT_PAUSE%"=="1" (
  echo.
  echo Press any key to close...
  pause >nul
)
endlocal
