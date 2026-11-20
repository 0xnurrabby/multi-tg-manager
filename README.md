# Multi TG Manager

A small dashboard that lets you manage several of your own Telegram accounts from one screen — see who's connected, change names and bios in bulk, watch the "Telegram" service messages for login alerts, leave groups, delete your messages, and so on.

It runs entirely on your own PC. Nothing is uploaded anywhere.

---

## What you actually need

You only need two things installed once. If you already have them, skip ahead.

1. **Python 3.10 or newer** — https://python.org/downloads
   - During install, **tick "Add Python to PATH"** on the very first screen. This matters.
2. **Node.js 18 or newer** — https://nodejs.org (pick the LTS green button)
   - Default install is fine, just keep clicking Next.

To check they installed correctly, open a fresh PowerShell or Command Prompt and run:
```
python --version
node --version
```
Both should print a version number. If you get "not recognized", reinstall and make sure the PATH option was checked.

---

## How to get the app

### Option A — Download as a ZIP (easiest)
1. Go to https://github.com/0xnurrabby/multi-tg-manager
2. Click the green **Code** button → **Download ZIP**
3. Right-click the ZIP → **Extract All** to somewhere simple like `C:\multi-tg-manager`

### Option B — With Git (if you know what `git clone` is)
```
git clone https://github.com/0xnurrabby/multi-tg-manager.git
```

---

## First run

1. **Open the folder** you extracted to.
2. **Double-click `start.bat`**.

A black window opens. The first time, it will:

- Create a Python virtual environment (about 30 seconds)
- Install all Python packages (about 2 minutes — be patient)
- Install all frontend packages (about 1 minute)
- Create a `backend\.env` file with your settings
- **Open Notepad** so you can fill in three things

In that Notepad file, change these three values:

```
TG_API_ID=
TG_API_HASH=
APP_PASSWORD=change-me-to-a-long-strong-password
```

- **`TG_API_ID` and `TG_API_HASH`** — get them from https://my.telegram.org
  1. Log in with your phone number
  2. Click **API development tools**
  3. Create an app (the name doesn't matter)
  4. Copy `api_id` and `api_hash` from the result page
- **`APP_PASSWORD`** — the password you'll type to open the dashboard. Pick something long and personal.

Save the file, close Notepad, and **double-click `start.bat` again**.

This time:
- The black window will say `Uvicorn running on http://127.0.0.1:8000`
- Your browser will open automatically after a few seconds
- The login screen will appear
- Enter your `APP_PASSWORD` and you're in

That's it. From now on, just double-click `start.bat` whenever you want to use the app. To stop, close the black window (or double-click `stop.bat`).

---

## Adding your first Telegram account

1. Click **+ Add Account** at the bottom-left.
2. Type your phone number with country code, e.g. `+8801712345678`.
3. Click **Send Code**.
4. Open Telegram on your phone — there'll be a 5-digit code from "Telegram".
5. Type the code into the dashboard, click **Verify Code**.
6. If the account has **Two-Step Verification (2FA)** enabled, it'll ask for your Telegram password. Type it, click **Submit 2FA**.

Done. The account shows up in the sidebar with a green "Connected" badge.

Repeat for every account you want to manage.

---

## Quick tour of what's where

### Sidebar (left)
Every account you've added. Click one to select it. Each row has:
- Avatar + name
- Phone number with a one-click copy button
- @username with a one-click copy button
- Status badge (Connected / Disconnected / Banned)
- 2FA badge if it's on, red alert count if there are unread security messages

### Tabs (top)
- **Dashboard** — overview of all accounts in a table; search and filter
- **Profile** — edit the selected account's name, username, bio, photo
- **Security** — see every "Telegram" service message per account (login codes, new login warnings, etc.) and manage active sessions
- **Groups** — join / leave groups & channels, plus delete every message *you* sent in any group
- **Messages** — send a message, react to a post, "view" a post to inflate its view count
- **Bulk** — apply changes (name, bio, photo) to many accounts at once, optionally from a CSV
- **Settings** — speed limits, session folder, export accounts as JSON

### Top bar
- Quick counts: total / connected / banned / 2FA / unread alerts
- Theme toggle (sun / moon)
- Power button = logout

---

## Some useful things to try

**Bulk rename with numbers**
Bulk tab → tick "Select all" → First Name `Family` → tick "Append number" starting at 1 → Apply. Every account becomes "Family 1", "Family 2", and so on.

**Bulk profiles from a CSV**
Make a text file `names.csv`:
```
Alice,Smith,Loves cats
Bob,Jones,Programmer
Carol,Davis,Tea drinker
```
Bulk tab → click the CSV upload → pick the file → tick the accounts in the order you want rows applied → Apply.

**Bulk profile photos**
Bulk tab → Bulk Profile Photo → Choose Files → pick a bunch of images. You can click "Choose Files" again to add more. The first photo goes to the first selected account, the second to the second, and so on.

**Pull old security messages from Telegram**
Security tab → expand an account → **Pull latest 50**. Useful for accounts you just added — it backfills the history so you can see old login codes.

**Delete all your messages in a group**
Groups tab → pick the account on the left sidebar → find the group in the list → **Del My Msgs**. It counts first (so you know what'll happen), asks you to confirm, then deletes — for everyone.

---

## Where your data lives

Everything stays in the project folder:
- `backend\.env` — your API keys and password (never commit this anywhere)
- `backend\app.db` — SQLite database of accounts and security messages
- `backend\sessions\*.session` — Telegram session files (treat these like passwords; whoever has them has full access to that account)

The app only listens on `127.0.0.1`, which means **only your own PC can reach it** — not your home network, not the internet.

---

## Troubleshooting

**The black window opens and closes instantly**
You probably opened it from inside the ZIP without extracting. Right-click the ZIP, Extract All, then run `start.bat` from the extracted folder.

**"Python not found on PATH"**
Reinstall Python and make sure you tick **"Add Python to PATH"** on the first screen. Then restart your terminal / reboot.

**"pip install failed"**
Check the messages in the black window. Most often it's a network problem — try again after a minute. If a specific package fails on a brand new Python version, open an issue.

**Login page says "Wrong password"**
Make sure the password in `backend\.env` is exactly what you're typing (no leading spaces, no quotes). Restart `start.bat` after changing `.env`.

**Locked out: "Too many attempts"**
Five wrong passwords lock the IP for the window set in `LOGIN_WINDOW_MIN` (default 15 min). Wait it out, or change `LOGIN_WINDOW_MIN=1` in `.env`, restart, and try again.

**Account stuck on "Sending..."**
Telegram's auth servers can be slow. The dashboard now times out after ~45 seconds. If it keeps happening, your network might be blocking Telegram — try a VPN.

**2FA always logs me out**
This is fixed — make sure you're running the latest version (`git pull` or re-download the ZIP).

**Security tab is empty**
The listener only catches *new* messages by default. Click **Pull latest 50** to backfill history.

---

## Updating

If you got the code with `git clone`:
```
git pull
```
Then double-click `start.bat`. The frontend will rebuild automatically.

If you downloaded the ZIP, just download a fresh one and replace the files (keep your `backend\.env`, `backend\app.db`, and `backend\sessions\` folder).

---

## Privacy and safety

- No telemetry. No analytics. Nothing leaves your computer.
- Your `backend\sessions\*.session` files are real Telegram credentials. Don't share them, don't copy them to another machine, don't upload them.
- `.env`, `app.db`, and `sessions/` are all in `.gitignore` — they won't accidentally get pushed to GitHub if you commit changes.

---

## What it's built with

- **Backend:** Python 3 + FastAPI + Telethon + SQLite (async)
- **Frontend:** React + Vite + Tailwind CSS (neo-brutalism look)
- **Auth:** bcrypt-hashed password, signed cookie, per-IP rate limit

You don't need to know any of that to use it.

---

## Folder layout

```
multi-tg-manager/
├── start.bat              ← double-click to run
├── stop.bat               ← double-click to stop
├── README.md              ← this file
├── backend/
│   ├── .env               ← your settings (created on first run)
│   ├── app/               ← FastAPI server code
│   ├── requirements.txt
│   ├── sessions/          ← Telegram session files
│   ├── static/            ← compiled frontend
│   └── app.db             ← SQLite database
└── frontend/
    ├── src/               ← React source code
    └── package.json
```

That's the whole thing. If something breaks, the black window will tell you what; if you're stuck, open an issue on the repo.
