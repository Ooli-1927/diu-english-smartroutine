# SmartRoutine API

REST backend for the DIU English Routine web app. Express 5 on Node with **MongoDB**
(official `mongodb` driver — no Mongoose).

## Requirements

- Node 22.5+
- MongoDB (local `mongod` or [Atlas](https://www.mongodb.com/cloud/atlas)) reachable via `MONGODB_URI`

## Quick start

```bash
# Copy env and set MONGODB_URI / MONGODB_DB
cp .env.example .env

npm install
npm start          # http://127.0.0.1:4000
```

On first boot, if the `teachers` collection is empty (or seed version mismatches), the API
seeds from `data/seed.json`.

```bash
npm run reset                    # wipe collections and reseed
node scripts/smoke.js            # auth / timetable / permission checks
node scripts/smoke-social.js     # appointment + notification checks
node scripts/smoke-generate.js   # routine generator checks
node scripts/smoke-conflicts.js  # conflict-checker and guard checks
```

The smoke scripts need a running server.

Copy `.env.example` to `.env` and set at least `JWT_SECRET` and `MONGODB_URI` before deploying.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `JWT_SECRET` | (required in prod) | Signing key for login tokens |
| `JWT_TTL` | `12h` | Token lifetime |
| `CORS_ORIGIN` | localhost:5173 (+ 127.0.0.1) in non-production; **required** in production (comma-separated; `*` rejected) | Allowed browser origins |
| `MONGODB_URI` | (required) | Mongo connection string |
| `MONGODB_DB` | `smartroutine` | Database name |

Standalone local Mongo does not support multi-document transactions; the API falls back to sequential writes. Atlas (replica set) uses transactions when available.

## Data model

Collections: `admins`, `teachers`, `students`, `batches`, `courses`, `rooms`, `timetable_entries`,
`notifications`, `appointments`, `appointment_slots`, `app_metadata`, plus push/Google/advanced
collections listed in `src/db.js`. Documents keep a string `id` (also used as `_id`).

Passwords are never stored in plain text: every account is seeded with a bcrypt hash and
no endpoint ever returns a `password_hash`.

## Authentication

`POST /api/auth/login` accepts an admin username, a teacher email/initial, or a student
email/ID and returns a JWT plus the session object the web client uses for routing.
Send it back as `Authorization: Bearer <token>`.

Roles: `super_admin`, `teacher_admin`, `teacher`, `student`.
