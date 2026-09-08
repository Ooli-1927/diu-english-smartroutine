# SmartRoutine setup — seed credentials

Passwords for seeded admins, teachers, and students are **generated at seed time**. They are never stored in committed source files.

## Install and run

```bash
# from repo root (DIU-SmartRoutine/)
npm install          # root deps (concurrently)
npm run install:all  # web + api deps
npm run dev          # API :4000 + Vite :5173 (Windows / macOS / Linux)
```

Open http://localhost:5173. Seed credentials print in the API terminal on first boot — see below.

Optional: `npm run dev:windows` still launches two PowerShell windows via `start-dev.ps1`.

## Where to find credentials

When the database is seeded (first API start, or an explicit reseed), the API prints a one-time table to the **terminal**:

```text
=== Seed credentials (shown once — save these now) ===
role            login                           password
…
=== End seed credentials ===
```

Copy those values somewhere safe (password manager, private notes). They are **not** written to any committed file and will not appear again unless you reseed.

## Force reseed (regenerate passwords)

```bash
cd backend
npm run reset
```

This wipes the local SQLite database and re-seeds from `data/seed.json`, printing a **new** credential list. Any previous seed passwords stop working.

You can also set `FORCE_SEED=1` when starting the API to reseed on boot.

## Smoke / e2e tests

Smoke scripts read passwords from environment variables (no hardcoded fallbacks):

| Variable | Typical login (username only; password from seed output) |
| --- | --- |
| `SEED_ADMIN_USERNAME` | defaults to `chairman` if unset |
| `SEED_ADMIN_PASSWORD` | **required** — from seed output |
| `SEED_TEACHER_USERNAME` | defaults to `LS` if unset |
| `SEED_TEACHER_PASSWORD` | **required** |
| `SEED_TEACHER2_USERNAME` | defaults to `EHE` if unset |
| `SEED_TEACHER2_PASSWORD` | **required** |
| `SEED_STUDENT_USERNAME` | defaults to `student01@diu.demo` if unset |
| `SEED_STUDENT_PASSWORD` | **required** |

Example (PowerShell), after copying values from the seed output:

```powershell
$env:SEED_ADMIN_PASSWORD = "<from seed output>"
$env:SEED_TEACHER_PASSWORD = "<from seed output>"
$env:SEED_TEACHER2_PASSWORD = "<from seed output>"
$env:SEED_STUDENT_PASSWORD = "<from seed output>"
node scripts/smoke.js
```

## Initial passwords (department-issued)

| Role | Username | Initial password |
|------|----------|------------------|
| Chairman | `Chairman` | `Chairman123` |
| Teacher | teacher initial (e.g. `ZTF`) | initial + `123` (e.g. `ZTF123`) |
| Student | student email | `12345678` |

Students and teachers may **change their password once**. After that, only the Chairman can reset it (Students / Teachers admin pages → reset). A full account list is written to gitignored `credentials.local.txt` when you run:

```bash
cd backend
npm run reset
```

## Professional email (Gmail SMTP) — skip FormSubmit “Activate”

Right now, if SMTP is unset, the API uses **`mail: auto`** (MX / FormSubmit). New student/teacher addresses often get a **Confirm / Activate** email first, and messages are not the branded HTML.

**Goal:** send routine updates as professional HTML **directly to the inbox** (no FormSubmit activate).

### A) Create a Gmail App Password

1. Use a Google account that will send mail (department Gmail is best).
2. [Google Account → Security](https://myaccount.google.com/security) → turn **2-Step Verification** ON.
3. Search **App passwords** → create one for **Mail** → copy the 16-character password.

### B) Save SMTP in the app (easiest)

1. Log in as **Chairman**.
2. Open **Profile** → **Professional email**.
3. Enter:
   - Gmail address (e.g. `dept.english@gmail.com`)
   - App Password (spaces OK — the app strips them)
   - From name: `DIU SmartRoutine` (or your choice)
4. Click **Save SMTP**, then **Send test** to your own inbox.
5. Check `/api/health` — `mail` should no longer be only `auto` (SMTP / professional path).

Credentials are stored in gitignored `backend/data/mail-smtp.json`.

### C) Or set SMTP in `.env`

In `backend/.env` (never commit):

```env
SMTP_USER=your.name@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
MAIL_FROM=your.name@gmail.com
MAIL_FROM_NAME=DIU SmartRoutine
```

Restart the API (`npm run dev` / `dev:api`). Confirm console / `/api/health` shows mail ready via SMTP.

### After SMTP works

- Cancel / reschedule → branded HTML to batch students + teacher.
- No FormSubmit “Activate” for each new address.
- Still check Spam once; ask recipients to mark Not spam / add sender to contacts.

## Google Calendar auto-sync (optional)

One-way sync: **SmartRoutine → Google Calendar** for students and teachers (Connect on Profile, Sync now, auto-update on cancel/reschedule/room change). Without these env vars, Connect is disabled; the rest of the app and `.ics` export still work.

### Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. Enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** — External is fine for testing. While the app is in **Testing**, add every Gmail you will use as a **test user**.
4. **Credentials → Create OAuth client ID → Web application**:
   - Authorized JavaScript origins: `http://localhost:5173` (plus your production frontend origin later).
   - Authorized redirect URIs: `http://localhost:4000/api/google/callback` (plus your production API callback later).
5. Copy Client ID and Client secret into `backend/.env` (never commit):

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4000/api/google/callback
PUBLIC_APP_URL=http://localhost:5173
```

6. Restart the API. On Profile, use **Connect Google Calendar** → allow access → **Sync now**. Events appear under a calendar named **DIU SmartRoutine**.
