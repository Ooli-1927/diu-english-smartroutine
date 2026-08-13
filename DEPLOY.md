# Free live preview (PC off থাকলেও চলবে)

API + database লাগে — **GitHub Pages** বা **Render Static Site** দিয়ে পুরো সাইট চলবে না।  
চাই: **Render → Web Service (Node)**।

---

## কালো পেজে শুধু "Not Found"?

সাধারণত **Static Site** বানিয়েছেন। মুছে **Web Service** বানান।

### Render Settings (Web Service)

| Field | Value |
| --- | --- |
| Root Directory | খালি (repo root) |
| Build Command | `bash ./scripts/render-build.sh` |
| Start Command | `npm --prefix smartroutine-api start` |
| Health Check Path | `/api/health` |

Env vars:

| Key | Value |
| --- | --- |
| `NODE_VERSION` | `22.14.0` |
| `JWT_SECRET` | যেকোনো লম্বা র‍্যান্ডম স্ট্রিং |
| `CORS_ORIGIN` | Your real frontend origin (e.g. `https://YOUR.onrender.com`) — never `*` |
| `NODE_ENV` | `production` |
| `WEB_DIST` | `smartroutine-api/public` |

তারপর **Manual Deploy → Deploy latest commit**।

চেক:
1. `https://YOUR.onrender.com/api/health` → `status: ok`
2. `https://YOUR.onrender.com/` → login পেজ

---

## গুরুত্বপূর্ণ

লোকাল ফিক্স GitHub এ **push** না করলে Render পুরনো কোডই চালাবে।  
GitHub Desktop → Commit → Push।

`.env` / password ফাইল আপলোড করবেন না।

Free tier প্রথম ওপেনে ৩০–৬০ সেকেন্ড sleep break লাগতে পারে।

---

## Offline / demo fallback (frontend)

যদি live API না পাওয়া যায়, web app **offline demo mode**-এ যায় — sticky banner + toast +
console warning। Login তবুও লাগে; appointments / mail SMTP / generate / lab / attendance
live server ছাড়া কাজ করে না। Browser-local edits live DIU server-এ যায় না।

## Supabase (optional)

Repo root [`supabase_schema.sql`](./supabase_schema.sql) — tables + **RLS** (anon deny;
JWT claims `role` / `user_id` / `teacher_initial` / `student_id`)। Render Express/SQLite
role logic এতে বদলায় না। Production-এ API ব্যবহার করুন; Supabase Auth claims না থাকলে
anon client দিয়ে data পড়বে না।
