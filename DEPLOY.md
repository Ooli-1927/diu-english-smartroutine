# Free live preview (PC off থাকলেও চলবে)

API + database লাগে — **GitHub Pages** বা **Render Static Site** দিয়ে পুরো সাইট চলবে না।  
চাই: **Render → Web Service (Node)**।

**Repo:** https://github.com/Ooli-1927/diu-english-smartroutine

---

## কালো পেজে শুধু "Not Found"?

সাধারণত **Static Site** বানিয়েছেন। মুছে **Web Service** বানান।

### Fast path (Blueprint)

1. Render dashboard → delete any **Static Site** named `diu-english-smartroutine`
2. Open: https://dashboard.render.com/blueprints  
   → **New Blueprint Instance** → connect `Ooli-1927/diu-english-smartroutine`
3. Apply `render.yaml` (Web Service, Node 22)
4. After deploy, Environment → set  
   `CORS_ORIGIN` = `https://diu-english-smartroutine.onrender.com`  
   (or whatever URL Render shows) → **Save** → Manual Deploy
5. Check:
   - `https://YOUR.onrender.com/api/health` → `"status":"ok"`
   - `https://YOUR.onrender.com/` → login page

### Manual Web Service settings

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
| `HOST` | `0.0.0.0` |

তারপর **Manual Deploy → Deploy latest commit**।

---

## গুরুত্বপূর্ণ

লোকাল ফিক্স GitHub এ **push** না করলে Render পুরনো কোডই চালাবে।

`.env` / password ফাইল আপলোড করবেন না।

Free tier প্রথম ওপেনে ৩০–৬০ সেকেন্ড sleep break লাগতে পারে। SQLite free disk wipe হতে পারে — demo/preview এর জন্য ঠিক আছে।
