# SmartRoutine Web — DIU English Routine

Full website conversion of the Capstone Flutter app (**DIU English Routine / SmartRoutine**) for the Department of English, DIU.

## Stack

- **Frontend:** React + TypeScript + Vite
- **Routing:** React Router
- **Backend:** [`smartroutine-api`](../smartroutine-api) — Express + SQLite with JWT auth and bcrypt password hashing
- **Fallbacks:** Supabase (optional) and offline JSON demo mode
- **PDF export:** jsPDF
- **UI:** Poppins + design tokens from `SCREENS.md`

## Features

| Role | Features |
|------|----------|
| **Student** | Own batch schedule (auto), teacher directory + appointments, room search, free rooms, notifications, profile + password |
| **Teacher** | Weekly schedule, cancel / reschedule / change room, notifications, accept/reject appointments, profile |
| **Super Admin** | Dashboard, batches, students, teachers, courses, rooms, timetable CRUD, routine generator, notices feed, PDF export, JSON/CSV import, analytics |

**Generate** (admin sidebar) builds a clash-free week from course assignments: pick batches,
load the current routine or add rows by hand, set the per-day limits, preview the proposal,
then apply it. Anything that cannot be placed is listed with the reason why.

**Conflict checker** runs everywhere the routine is edited. The dashboard, timetable and
generate pages list every room, teacher and batch clash with both classes side-by-side.
Click *Go to schedule* to jump to that class in the timetable (highlighted). Click
*Resolve* to see clash-free options — move to a free room, run online, or shift to another
period — and applying one clears the clash. Clashing cards in the timetable also name the
partner class.

Cancelling, rescheduling or moving a class writes a notification for the affected batch and
teacher, so the bell badge in the student and teacher portals updates on its own (polled
every 60s). In offline demo mode notifications are derived from cancelled classes instead,
and appointment booking is disabled since it needs the server.

## Quick start (frontend + backend)

From the **repo root** (cross-platform):

```bash
npm install
npm run install:all
npm run dev                 # API http://127.0.0.1:4000 + web http://localhost:5173
```

Or two terminals:

```bash
# 1. backend — creates and seeds data/smartroutine.db on first run
cd smartroutine-api
npm install
npm start                # http://127.0.0.1:4000

# 2. frontend
cd smartroutine-web
npm install
npm run dev              # http://localhost:5173
```

Vite proxies `/api` to `http://127.0.0.1:4000`, so no CORS setup is needed in development.
Override the target with `VITE_API_TARGET`, or point the built app at a deployed API with
`VITE_API_URL=https://your-api.example.com/api`.

### Logins

Demo/seed credentials are generated at setup time and printed to the console — see [SETUP.md](../SETUP.md) for details.

## Backend modes

The app detects its data source at startup and shows it in the admin sidebar / login pill:

1. **Live server + SQLite** — `/api/health` responds. All reads and writes go through the
   REST API; passwords are verified server-side and permissions are enforced per role.
2. **Supabase cloud** — no API, but `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set.
3. **Offline demo data** — neither is available. Seeded from `public/data/data.json` and
   persisted in browser `localStorage`, which is useful for demos without a server.

When the live API is unreachable, the UI shows a persistent **offline banner**, logs a
console warning, and toasts once. Login is still required (demo credentials against the
seeded store). Server-only actions (appointments, SMTP/mail, generate/apply, lab ops,
attendance, personal optimizer) stay disabled. Browser-local CRUD is labeled as demo-only.

To use Supabase instead of the bundled API, copy `.env.example` → `.env`, fill in the two
Supabase variables, run [`../supabase_schema.sql`](../supabase_schema.sql) in the Supabase
SQL editor, and start the frontend without the API running.

**Supabase RLS:** the schema enables Row Level Security on all core tables and **denies
anon**. Policies expect JWT claims `role`, `user_id`, and optionally `teacher_initial` /
`student_id` (see comments at the top of `supabase_schema.sql`). The current anon-only
client loader will not read data until Supabase Auth issues those claims — do not weaken
RLS; prefer the Express API for production.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server (proxies `/api`) |
| `npm run build` | Type-check + production build â†’ `dist/` |
| `npm run preview` | Preview production build |

## Project layout

```
CapstoneLast/
â”œâ”€â”€ smartroutine-api/      # Express + SQLite backend (REST, JWT, seed, smoke tests)
â”œâ”€â”€ smartroutine-web/
â”‚   â”œâ”€â”€ public/data/       # Seed JSON + import templates
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ components/    # ScheduleCard, etc.
â”‚       â”œâ”€â”€ context/       # Auth + data store (API / Supabase / local)
â”‚       â”œâ”€â”€ lib/           # API client, Supabase, types, PDF, constants
â”‚       â””â”€â”€ pages/         # Login, student, teacher, admin
â””â”€â”€ CapstoneLast/          # Original Flutter project
```

## Notes

- Flutter `lib/` source was missing in this Capstone copy; the web app was rebuilt from `README.md`, `SCREENS.md`, `supabase_schema.sql`, and `assets/data.json`.
- Demo credentials are generated at seed time (printed to the API console) — see SETUP.md. Do not commit passwords.
- The imported routine had 4 room clashes (rooms 2001 and 1001 were shared by two batches in
  the same period). Those four classes were moved to 2002 and 1002, so the shipped data is
  clean; `node scripts/audit-conflicts.js` in `smartroutine-api` verifies it.
- Teachers can only edit their own classes and profile; student and teacher lists are only
  exposed to super admins.
