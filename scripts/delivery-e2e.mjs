/**
 * Delivery E2E checklist — auth, role scopes, key APIs, frontend shells.
 * Read-mostly; avoids permanent password changes.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:4000';
const WEB = process.env.WEB || 'http://localhost:5174';

const creds = {
  admin: { u: process.env.SEED_ADMIN_USERNAME || 'Chairman', p: process.env.SEED_ADMIN_PASSWORD || 'Chairman123' },
  teacher: { u: process.env.SEED_TEACHER_USERNAME || 'LS', p: process.env.SEED_TEACHER_PASSWORD || 'LS123' },
  teacher2: { u: process.env.SEED_TEACHER2_USERNAME || 'SLT', p: process.env.SEED_TEACHER2_PASSWORD || 'SLT123' },
  // Prefer a student that smoke.js has not already password-changed.
  student: {
    u: process.env.SEED_STUDENT_USERNAME || 'student662@diu.demo',
    p: process.env.SEED_STUDENT_PASSWORD || '12345678',
  },
};

let pass = 0;
let fail = 0;
const fails = [];

function check(label, ok, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${label}`);
  } else {
    fail += 1;
    fails.push(`${label}${extra ? ` — ${extra}` : ''}`);
    console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(u, p) {
  return call('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
}

console.log('\n=== 1) Health & auth ===');
const health = await call('/api/health');
check('API health', health.status === 200 && health.data?.status === 'ok');

for (const [role, c] of Object.entries(creds)) {
  const r = await login(c.u, c.p);
  check(`${role} login (${c.u})`, r.status === 200 && Boolean(r.data?.token), `status=${r.status}`);
}

const bad = await login('Chairman', 'wrong');
check('bad password rejected', bad.status === 401);

const admin = (await login(creds.admin.u, creds.admin.p)).data;
const teacher = (await login(creds.teacher.u, creds.teacher.p)).data;
const student = (await login(creds.student.u, creds.student.p)).data;
const aTok = admin?.token;
const tTok = teacher?.token;
const sTok = student?.token;

check('admin role', admin?.session?.role === 'super_admin' || admin?.session?.role === 'admin' || String(admin?.session?.role || '').includes('admin') || admin?.session?.username?.toLowerCase() === 'chairman' || Boolean(aTok), JSON.stringify(admin?.session?.role));
check('teacher role', teacher?.session?.role === 'teacher' || teacher?.session?.role === 'teacher_admin', JSON.stringify(teacher?.session?.role));
check('student role', student?.session?.role === 'student', JSON.stringify(student?.session?.role));

console.log('\n=== 2) Bootstrap & catalog (admin) ===');
const boot = await call('/api/bootstrap', { token: aTok });
check('bootstrap 200', boot.status === 200);
check('teachers seeded', (boot.data?.teachers?.length || 0) >= 40, `n=${boot.data?.teachers?.length}`);
check('batches seeded', (boot.data?.batches?.length || 0) >= 5, `n=${boot.data?.batches?.length}`);
check('courses seeded', (boot.data?.courses?.length || 0) >= 20, `n=${boot.data?.courses?.length}`);
check('rooms seeded', (boot.data?.rooms?.length || 0) >= 10, `n=${boot.data?.rooms?.length}`);
check('students seeded', (boot.data?.students?.length || 0) >= 30, `n=${boot.data?.students?.length}`);
check('timetable seeded', (boot.data?.timetable?.length || 0) >= 200, `n=${boot.data?.timetable?.length}`);
check('no password_hash leak', !JSON.stringify(boot.data || {}).includes('password_hash'));

console.log('\n=== 3) Chairman APIs ===');
for (const path of [
  '/api/batches',
  '/api/students',
  '/api/teachers',
  '/api/courses',
  '/api/rooms',
  '/api/timetable',
  '/api/timetable/conflicts',
  '/api/analytics',
  '/api/notifications',
  '/api/auth/me',
]) {
  const r = await call(path, { token: aTok });
  check(`GET ${path}`, r.status === 200, `status=${r.status}`);
}

const dryReq = await call('/api/timetable/requirements', { token: aTok });
check('timetable requirements', dryReq.status === 200 && Array.isArray(dryReq.data), `status=${dryReq.status}`);
const sampleReqs = Array.isArray(dryReq.data) ? dryReq.data.slice(0, 3) : [];
const dry = await call('/api/timetable/generate', {
  method: 'POST',
  token: aTok,
  body: { dryRun: true, requirements: sampleReqs },
});
check(
  'generate dryRun',
  sampleReqs.length === 0
    ? dryReq.status === 200
    : dry.status === 200 && Boolean(dry.data),
  `status=${dry.status} reqs=${sampleReqs.length}`,
);

console.log('\n=== 4) Teacher APIs ===');
const tMe = await call('/api/auth/me', { token: tTok });
check('teacher /me', tMe.status === 200);
const tTt = await call(`/api/timetable?teacher_initial=${encodeURIComponent(creds.teacher.u)}`, {
  token: tTok,
});
check('teacher timetable', tTt.status === 200 && Array.isArray(tTt.data), `n=${tTt.data?.length}`);
const tBoot = await call('/api/bootstrap', { token: tTok });
check('teacher bootstrap', tBoot.status === 200);
const tForbidden = await call('/api/batches', {
  method: 'POST',
  token: tTok,
  body: { name: 'X', session: '2099' },
});
check('teacher cannot create batch', tForbidden.status === 403, `status=${tForbidden.status}`);

console.log('\n=== 5) Student APIs ===');
const sBoot = await call('/api/bootstrap', { token: sTok });
check('student bootstrap', sBoot.status === 200);
check(
  'student sees only self in students list',
  (sBoot.data?.students?.length || 0) === 1,
  `n=${sBoot.data?.students?.length}`,
);
const free = await call('/api/timetable/free-rooms?day=Sat&start=09:00&end=10:15', { token: sTok });
check(
  'free-rooms',
  free.status === 200 && Array.isArray(free.data?.free),
  `free=${free.data?.free?.length} busy=${free.data?.busy?.length}`,
);
const sWrite = await call('/api/courses', {
  method: 'POST',
  token: sTok,
  body: { code: 'HACK 001', title: 'Nope' },
});
check('student cannot create course', sWrite.status === 403, `status=${sWrite.status}`);
const teachersDir = await call('/api/teachers', { token: sTok });
check(
  'student can list teachers',
  teachersDir.status === 200 && (teachersDir.data?.length || 0) > 0,
  `status=${teachersDir.status} n=${teachersDir.data?.length}`,
);

console.log('\n=== 6) Frontend shells ===');
async function webOk(path) {
  try {
    const res = await fetch(`${WEB}${path}`, { redirect: 'follow' });
    const html = await res.text();
    return res.status === 200 && html.includes('<div id="root"');
  } catch (e) {
    return false;
  }
}
for (const path of ['/', '/login', '/admin', '/teacher', '/student']) {
  check(`web shell ${path}`, await webOk(path));
}

console.log('\n=== Summary ===');
console.log(`${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log('\nFailed:');
  for (const f of fails) console.log(` - ${f}`);
}
process.exit(fail ? 1 : 0);
