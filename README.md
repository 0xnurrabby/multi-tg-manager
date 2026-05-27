# Multi TG Manager

Personal dashboard to manage up to ~15 family-owned Telegram accounts from one screen.
Runs **100% locally** on your PC. Single password-protected app.

## One-click run (Windows)

1. Install **Python 3.10+** and **Node.js 18+** (one-time, from python.org and nodejs.org).
2. Double-click **`start.bat`**.
   - **First run:** it creates the Python venv, installs all deps, generates a `backend\.env` with a random session secret, then opens Notepad so you can fill:
     - `TG_API_ID` and `TG_API_HASH` — from https://my.telegram.org → API development tools
     - `APP_PASSWORD` — your login password (use a long, strong one)
   - Save the file, **close Notepad**, **double-click `start.bat` again**.
   - Browser opens automatically at `http://localhost:8000` → login screen.
3. To stop: just close the black console window (or run `stop.bat`).

## Security

- App is **password-gated** by `APP_PASSWORD`. Login uses bcrypt-hashed verification + HttpOnly signed session cookie (14-day default).
- **5 wrong passwords in 15 min locks the IP out** (rate-limited).
- Server binds to `127.0.0.1` only — not reachable from your LAN/internet.
- Telethon `.session` files live in `backend/sessions/` and are git-ignored. **Never commit them, never copy them off this machine.**

## Features

- 15-account sidebar with live status (connected/disconnected/banned), online dot, one-click copy for phone & @username
- Top stats bar with real-time alert counter
- Profile tab: edit name / username / bio / photo per account
- **Security center**: captures all 777000 messages, classified (login_code / new_login / 2fa_change / account_deletion), with desktop browser notifications. Active session list + terminate.
- Groups: join / bulk-join / leave / bulk-leave + copy invite links
- Messaging: send, bulk send, react to post, view post
- Bulk profile + photo (2–4 s random delay between accounts → avoids FloodWait)
- Settings: rate limit, sessions folder, JSON export
- Neo-brutalism dark/light theme

## Manual run (if you don't want start.bat)

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # then edit
uvicorn app.main:app --port 8000

# Frontend (dev mode, hot reload)
cd frontend
npm install
npm run dev              # → http://localhost:5173

# OR build once for production-style single-port:
npm run build            # outputs to backend/static/
# then just run the uvicorn command above → everything served on :8000
```

## Folder layout

```
Multi Tg Manager/
├── start.bat              ← double-click to launch
├── stop.bat
├── backend/
│   ├── .env               ← created on first run, DO NOT COMMIT
│   ├── app/               ← FastAPI + Telethon + auth
│   ├── sessions/          ← .session files, gitignored
│   ├── static/            ← built frontend, gitignored
│   └── app.db             ← SQLite, gitignored
└── frontend/
    ├── src/
    └── package.json
```
