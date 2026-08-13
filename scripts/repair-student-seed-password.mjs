/**
 * Reset demo student seed password via chairman (one-time repair after smoke).
 * Uses smoke-credentials defaults — no values printed.
 */
import { requireSmokeCredentials } from '../smartroutine-api/scripts/smoke-credentials.js';

const BASE = process.env.BASE || 'http://127.0.0.1:4000';
const creds = requireSmokeCredentials();

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

const admin = await call('/api/auth/login', {
  method: 'POST',
  body: { username: creds.adminUser, password: creds.adminPass },
});
if (admin.status !== 200) {
  console.error('FAIL admin login', admin.status);
  process.exit(1);
}

const list = await call('/api/students', { token: admin.data.token });
const row = (list.data || []).find(
  (s) => String(s.email || '').toLowerCase() === String(creds.studentUser).toLowerCase(),
);
if (!row) {
  console.error('FAIL student not found');
  process.exit(1);
}

const reset = await call(`/api/students/${row.id}`, {
  method: 'PUT',
  token: admin.data.token,
  body: { password: creds.studentPass },
});
if (reset.status !== 200) {
  console.error('FAIL reset', reset.status, reset.data);
  process.exit(1);
}

const login = await call('/api/auth/login', {
  method: 'POST',
  body: { username: creds.studentUser, password: creds.studentPass },
});
console.log(login.status === 200 ? 'PASS student seed password restored' : `FAIL login ${login.status}`);
process.exit(login.status === 200 ? 0 : 1);
