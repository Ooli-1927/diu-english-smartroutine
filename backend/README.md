# SmartRoutine API

REST backend + database for the DIU English Routine web app. Express 5 on Node, with a real SQL
database (SQLite through Node's built-in `node:sqlite`, so there is nothing to compile or
install separately).

## Requirements

- Node 22.5+ (Node 24 recommended — `node:sqlite` must be available)

## Quick start

```bash
npm install
npm start          # http://127.0.0.1:4000
```

On first boot an empty database is created at `data/smartroutine.db` and seeded from
`data/seed.json` (the routine dump exported from the original Flutter app).

```bash
npm run reset                    # wipe and reseed the database
node scripts/smoke.js            # 24 auth / timetable / permission checks
node scripts/smoke-social.js     # 12 appointment + notification checks
node scripts/smoke-generate.js   # 18 routine generator checks
node scripts/smoke-conflicts.js  # 20 conflict-checker and guard checks
node scripts/audit-conflicts.js  # list teacher/room clashes in the stored routine
node scripts/fix-seed-conflicts.js data/seed.json [--dry-run]   # repair clashes in a data file
```

The smoke scripts need a running server; the audit and the fixer read the database and the
seed file directly.

Copy `.env.example` to `.env` and set at least `JWT_SECRET` before deploying anywhere real.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `JWT_SECRET` | dev fallback | Signing key for login tokens |
| `JWT_TTL` | `12h` | Token lifetime |
| `CORS_ORIGIN` | localhost:5173 (+ 127.0.0.1) in non-production; **required** in production (comma-separated; `*` rejected) | Allowed browser origins |
| `DB_PATH` | `data/smartroutine.db` | SQLite file location |

## Data model

`admins`, `teachers`, `students`, `batches`, `courses`, `rooms`, `timetable_entries`,
`notifications`, `appointments`, `app_metadata` — mirrors repo-root [`supabase_schema.sql`](../supabase_schema.sql)
(with RLS for optional Supabase use). Express/SQLite enforces the same role matrix at runtime,
with foreign keys and indexes on the columns the timetable queries filter by.

Passwords are never stored in plain text: every account is seeded with a bcrypt hash and
no endpoint ever returns a `password_hash`.

## Authentication

`POST /api/auth/login` accepts an admin username, a teacher email/initial, or a student
email/ID and returns a JWT plus the session object the web client uses for routing.
Send it back as `Authorization: Bearer <token>`.

Roles: `super_admin`, `teacher_admin`, `teacher`, `student`.

## Endpoints

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/health` | public |
| POST | `/api/auth/login` | public |
| GET | `/api/auth/me` | any signed-in user |
| POST | `/api/auth/change-password` | own account |
| GET | `/api/bootstrap` | any signed-in user (students only see their own record) |
| GET | `/api/timetable` | any signed-in user (`?day=&batch_id=&teacher_initial=&room_id=`) |
| GET | `/api/timetable/free-rooms` | any signed-in user (`?day=&start=&end=`) |
| POST | `/api/timetable` | super admin |
| PATCH | `/api/timetable/:id` | super admin, or the teacher who owns the class |
| DELETE | `/api/timetable/:id` | super admin |
| POST | `/api/timetable/import` | super admin (`{ entries, replace }`) |
| GET | `/api/timetable/conflicts` | super admin (standing clash report) |
| GET | `/api/timetable/requirements` | super admin (current routine as course assignments) |
| GET | `/api/timetable/slots` | super admin (days + period times in use) |
| POST | `/api/timetable/generate` | super admin (see below) |
| GET | `/api/teachers` `/api/batches` `/api/courses` `/api/rooms` | any signed-in user |
| POST/PUT/DELETE | same collections | super admin (teachers may PUT their own profile) |
| GET/POST/PUT/DELETE | `/api/students` | super admin |
| GET | `/api/analytics` | super admin |
| GET | `/api/notifications`, PATCH `/api/notifications/:id/read` | own audience |
| GET | `/api/appointments` | own records |
| POST | `/api/appointments` | student |
| PATCH | `/api/appointments/:id` | owning teacher or super admin |

Cancelling, rescheduling, moving or removing a class automatically writes notification
rows for the affected batch and teacher **and queues email** to every student email in that
batch plus the teacher's email. Appointment create/accept/reject does the same.

Mail is fire-and-forget (async queue) so API latency stays low. Configure SMTP in `.env`
(see `.env.example`). Without SMTP, messages are written to `data/mail-outbox/` for local
verification. Demo addresses like `@diu.demo` are skipped unless `MAIL_ALLOW_DEMO=1`.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/mail/status` | super admin |
| POST | `/api/mail/test` | super admin (`{ "to": "you@mail.com" }`) |

## Conflict checker

`src/conflicts.js` holds the single definition of a clash and is used in two places:

- `GET /api/timetable/conflicts` returns `{ summary, conflicts }` — one entry per clashing
  pair, with the day, period, the resource at fault and both classes involved.
- `POST /api/timetable` and `PATCH /api/timetable/:id` refuse a clash with `409` and the
  same conflict details. A super admin can override with `"force": true`; a teacher cannot,
  so rescheduling into an occupied slot always fails.

Two classes clash when their periods overlap on the same day and they share a room, share a
teacher, or belong to the same batch. Different lab groups of one batch running in parallel
are not a clash. Cancelled classes are ignored, so cancelling and restoring keeps working.

Bulk `import` and `generate` do not block: they report a `conflicts` summary in the
response, and the generator avoids creating clashes in the first place.

## Routine generator

`POST /api/timetable/generate` turns a list of course assignments into a clash-free week.

```json
{
  "requirements": [
    { "batch_id": "7th", "course_code": "ET 401", "teacher_initial": "AR",
      "type": "Lecture", "mode": "Onsite", "group_name": null, "sessions_per_week": 2 }
  ],
  "days": ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu"],
  "replace": true,
  "dryRun": true,
  "maxPerBatchPerDay": 3,
  "maxPerTeacherPerDay": 4
}
```

Hard rules enforced by `src/scheduler.js`:

- a teacher is never in two places in the same period
- a room is never shared in the same period
- a batch gets one class per period, unless the classes are different lab groups
- a course does not repeat for a batch on the same day
- per-day caps for both batch and teacher
- `mode: "Online"` classes take no room; `type: "Sessional"` prefers lab rooms

Sessions are placed hardest-first and each one takes the emptiest feasible day, which
spreads the week evenly. Anything that cannot be placed is returned in `unscheduled` with
the reason instead of failing the whole request. With `dryRun: true` (the default) nothing
is written, so the admin UI can show a preview before saving.

## Demo accounts

Demo/seed credentials are generated at setup time and printed to the console — see [SETUP.md](../SETUP.md) for details.
