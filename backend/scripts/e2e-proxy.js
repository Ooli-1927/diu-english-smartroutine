const WEB = process.env.WEB || 'http://127.0.0.1:5173';

let pass = 0;
let fail = 0;
function check(label, ok, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${label} ${extra}`);
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const page = await fetch(WEB);
const html = await page.text();
check('dev server serves the app', page.ok && html.includes('<div id="root">'));

const health = await call('/api/health');
check('vite proxies /api/health to the server', health.data?.status === 'ok', JSON.stringify(health.data));

const adminUser = process.env.SEED_ADMIN_USERNAME || 'Chairman';
const adminPass = process.env.SEED_ADMIN_PASSWORD || 'Chairman123';

const login = await call('/api/auth/login', {
  method: 'POST',
  body: { username: adminUser, password: adminPass },
});
check('login through proxy', login.status === 200 && Boolean(login.data?.token));

const boot = await call('/api/bootstrap', { token: login.data?.token });
check(
  'bootstrap through proxy',
  boot.status === 200 && boot.data.teachers.length > 0 && boot.data.timetable.length > 0,
  JSON.stringify({ teachers: boot.data?.teachers?.length, classes: boot.data?.timetable?.length }),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
