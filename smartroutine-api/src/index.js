import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';
import { authRouter } from './routes/auth.js';
import { bootstrapRouter } from './routes/bootstrap.js';
import { entitiesRouter } from './routes/entities.js';
import { timetableRouter } from './routes/timetable.js';
import { miscRouter } from './routes/misc.js';
import { advancedRouter } from './routes/advanced.js';
import { dbPath, get, isEmpty, projectRoot } from './db.js';
import { seed } from './seed.js';
import { isMailConfigured, mailStatus } from './mail.js';
import { initWebPush, isPushConfigured } from './push.js';
import { isGoogleCalendarConfigured } from './googleCalendar.js';
import { googleRouter } from './routes/google.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const IS_PROD = process.env.NODE_ENV === 'production';
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** Comma-separated CORS_ORIGIN; "*" is never allowed. Localhost only outside production. */
function resolveAllowedOrigins() {
  const fromEnv = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o && o !== '*');

  if (IS_PROD) {
    if (!fromEnv.length) {
      console.warn(
        'CORS_ORIGIN is unset (or was "*") in production — browser cross-origin requests will be denied. Set CORS_ORIGIN to your frontend origin(s).',
      );
    }
    return fromEnv;
  }

  return [...new Set([...DEV_ORIGINS, ...fromEnv])];
}

const ORIGINS = resolveAllowedOrigins();

/** Prefer API-local public/ (Render-safe), then monorepo dist. */
function resolveWebDist() {
  const candidates = [
    process.env.WEB_DIST,
    join(__dirname, '..', 'public'),
    join(process.cwd(), 'public'),
    join(process.cwd(), 'smartroutine-api', 'public'),
    join(__dirname, '..', '..', 'smartroutine-web', 'dist'),
    join(process.cwd(), 'smartroutine-web', 'dist'),
    join(process.cwd(), '..', 'smartroutine-web', 'dist'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(join(p, 'index.html'))) return p;
  }
  return null;
}

const WEB_DIST = resolveWebDist();

app.use(
  cors({
    origin(origin, cb) {
      // Non-browser / same-origin clients often omit Origin.
      if (!origin) return cb(null, true);
      if (ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  }),
);
app.use(express.json({ limit: '5mb' }));
app.use(authenticate);

app.get('/api/health', (_req, res) => {
  const mail = mailStatus();
  res.json({
    status: 'ok',
    database: 'sqlite',
    seeded: !isEmpty(),
    mail: mail.mode || (isMailConfigured() ? 'ready' : 'off'),
    push: isPushConfigured() ? 'ready' : 'off',
    googleCalendar: isGoogleCalendarConfigured() ? 'ready' : 'off',
    web: Boolean(WEB_DIST),
    webDist: WEB_DIST,
  });
});

app.use('/api/auth', authRouter);
app.use('/api/google', googleRouter);
app.use('/api', bootstrapRouter);
app.use('/api', entitiesRouter);
app.use('/api', timetableRouter);
app.use('/api', miscRouter);
app.use('/api', advancedRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const message =
    status >= 500 ? 'Internal server error' : err.message || 'Request failed';
  res.status(status).json({ error: message });
});

/** Production / free-host: one URL serves API + built React app (PC can be off). */
if (WEB_DIST) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    // Don't SPA-fallback missing static assets (png/css/js) into index.html
    if (/\.[a-z0-9]+$/i.test(req.path) && !req.path.endsWith('.html')) {
      return res.status(404).type('text').send('Not found');
    }
    res.sendFile(join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>DIU SmartRoutine</title>' +
          '<body style="font-family:system-ui;padding:2rem">' +
          '<h1>API is running</h1>' +
          '<p>Web UI build missing. Redeploy with a <strong>Web Service</strong> (not Static Site) and build the React app into <code>smartroutine-api/public</code>.</p>' +
          '<p><a href="/api/health">/api/health</a></p></body>',
      );
  });
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
}

function seedFileVersion() {
  try {
    const raw = JSON.parse(readFileSync(join(projectRoot, 'data', 'seed.json'), 'utf8'));
    return String(raw?.meta?.version || '');
  } catch {
    return '';
  }
}

function dbSeedVersion() {
  try {
    return String(get('SELECT version FROM app_metadata LIMIT 1')?.version || '');
  } catch {
    return '';
  }
}

initWebPush();

const wantedVersion = seedFileVersion();
const currentVersion = isEmpty() ? '' : dbSeedVersion();
const forceEnv = ['1', 'true', 'yes'].includes(String(process.env.FORCE_SEED || '').toLowerCase());
const needsSeed = forceEnv || isEmpty() || (wantedVersion && wantedVersion !== currentVersion);

if (needsSeed) {
  console.log(
    forceEnv
      ? 'FORCE_SEED enabled — reseeding from data/seed.json'
      : isEmpty()
        ? 'Empty database detected — seeding from data/seed.json'
        : `Seed version changed (${currentVersion || 'none'} → ${wantedVersion}) — reseeding`,
  );
  seed({ force: true });
}

app.listen(PORT, HOST, () => {
  console.log(`SmartRoutine listening on http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${dbPath}`);
  console.log(
    ORIGINS.length
      ? `CORS origins: ${ORIGINS.join(', ')}`
      : 'CORS origins: (none — set CORS_ORIGIN for browser clients)',
  );
  console.log(
    WEB_DIST
      ? `Web UI: serving ${WEB_DIST}`
      : 'Web UI: not found (API only — run smartroutine-web build for combined deploy)',
  );
  const mail = mailStatus();
  console.log(
    mail.configured
      ? `Mail: ready (${mail.mode}) from ${mail.from}`
      : 'Mail: disabled',
  );
  console.log(isPushConfigured() ? 'Web Push: ready (VAPID)' : 'Web Push: disabled');
  console.log(
    isGoogleCalendarConfigured()
      ? 'Google Calendar sync: ready'
      : 'Google Calendar sync: disabled',
  );
});
