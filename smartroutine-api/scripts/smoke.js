import { requireSmokeCredentials } from './smoke-credentials.js';

const BASE = process.env.BASE || 'http://127.0.0.1:4000';
const creds = requireSmokeCredentials();

let pass = 0;
let fail = 0;

function check(label, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${label} ${extra}`);
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function login(username, password) {
  const res = await call('/api/auth/login', { method: 'POST', body: { username, password } });
  return res;
}

const health = await call('/api/health');
check('health ok', health.status === 200 && health.data?.status === 'ok', JSON.stringify(health.data));

const bad = await login(creds.adminUser, 'wrong-password');
check('wrong password rejected', bad.status === 401);

const admin = await login(creds.adminUser, creds.adminPass);
check('admin login', admin.status === 200 && Boolean(admin.data?.token), JSON.stringify(admin.data));
const adminToken = admin.data?.token;

const noAuth = await call('/api/bootstrap');
check('bootstrap requires auth', noAuth.status === 401);

const boot = await call('/api/bootstrap', { token: adminToken });
check(
  'admin bootstrap payload',
  boot.status === 200 &&
    boot.data.teachers.length >= 40 &&
    boot.data.timetable.length >= 200 &&
    // Admins may have added students since the seed, so only the floor is fixed.
    boot.data.students.length >= 30,
  JSON.stringify({
    teachers: boot.data?.teachers?.length,
    timetable: boot.data?.timetable?.length,
    students: boot.data?.students?.length,
  }),
);
check('passwords never leave the API', !JSON.stringify(boot.data).includes('password_hash'));

const teacher = await login(creds.teacherUser, creds.teacherPass);
check(
  'teacher-admin login',
  teacher.status === 200 && teacher.data?.session?.teacherInitial === creds.teacherUser,
);
const teacherToken = teacher.data?.token;

const arEntries = await call(`/api/timetable?teacher_initial=${encodeURIComponent(creds.teacherUser)}`, {
  token: teacherToken,
});
check('teacher schedule list', arEntries.status === 200 && arEntries.data.length > 0, `count=${arEntries.data?.length}`);

const target = arEntries.data[0];
const cancel = await call(`/api/timetable/${target.id}`, {
  method: 'PATCH',
  token: teacherToken,
  body: { is_cancelled: true, cancellation_reason: 'Smoke test' },
});
check(
  'teacher can cancel own class',
  cancel.status === 200 && cancel.data.is_cancelled === true && cancel.data.cancellation_reason === 'Smoke test',
  JSON.stringify(cancel.data),
);

const notes = await call('/api/notifications', { token: teacherToken });
check(
  'cancellation created a notification',
  notes.status === 200 && notes.data.some((n) => n.type === 'class_cancelled'),
  `count=${notes.data?.length}`,
);

const restore = await call(`/api/timetable/${target.id}`, {
  method: 'PATCH',
  token: teacherToken,
  body: { is_cancelled: false, cancellation_reason: null },
});
check('teacher can restore own class', restore.status === 200 && restore.data.is_cancelled === false);

const otherEntry = arEntries.data.length
  ? (await call(`/api/timetable?teacher_initial=${encodeURIComponent(creds.teacher2User)}`, { token: teacherToken }))
      .data[0]
  : null;
if (otherEntry) {
  const forbidden = await call(`/api/timetable/${otherEntry.id}`, {
    method: 'PATCH',
    token: teacherToken,
    body: { is_cancelled: true },
  });
  check("teacher cannot edit another teacher's class", forbidden.status === 403, `status=${forbidden.status}`);
}

const teacherCreate = await call('/api/timetable', {
  method: 'PATCH',
  token: teacherToken,
});
check('unknown method/route handled', teacherCreate.status === 404 || teacherCreate.status === 400);

const student = await login(creds.studentUser, creds.studentPass);
check('student login', student.status === 200 && student.data?.session?.role === 'student');
const studentToken = student.data?.token;

const studentBoot = await call('/api/bootstrap', { token: studentToken });
check(
  'student bootstrap hides other students',
  studentBoot.status === 200 && studentBoot.data.students.length === 1,
  `count=${studentBoot.data?.students?.length}`,
);

const studentWrite = await call('/api/batches', {
  method: 'POST',
  token: studentToken,
  body: { name: 'Hack Batch', session: '2099' },
});
check('student cannot create batches', studentWrite.status === 403, `status=${studentWrite.status}`);

const freeRooms = await call('/api/timetable/free-rooms?day=Sat&start=09:00&end=10:15', {
  token: studentToken,
});
check(
  'free rooms endpoint',
  freeRooms.status === 200 && Array.isArray(freeRooms.data.free) && freeRooms.data.busy.length > 0,
  JSON.stringify({ free: freeRooms.data?.free?.length, busy: freeRooms.data?.busy?.length }),
);

const analytics = await call('/api/analytics', { token: adminToken });
check(
  'analytics totals',
  analytics.status === 200 && analytics.data.totals.classes >= 200 && Object.keys(analytics.data.byDay).length > 0,
  JSON.stringify(analytics.data?.totals),
);

const badEntry = await call('/api/timetable', {
  method: 'POST',
  token: adminToken,
  body: {
    day: 'Funday',
    batch_id: 'nope',
    teacher_initial: 'ZZZ',
    course_code: 'XXX 000',
    type: 'Lecture',
    mode: 'Onsite',
    start_time: '9:00',
    end_time: '10:00',
  },
});
check('validation rejects bad class', badEntry.status === 400, JSON.stringify(badEntry.data));

const created = await call('/api/timetable', {
  method: 'POST',
  token: adminToken,
  body: {
    day: 'Thu',
    batch_id: boot.data.batches[0].id,
    teacher_initial: creds.teacherUser,
    course_code: boot.data.courses[0].code,
    type: 'Lecture',
    mode: 'Onsite',
    start_time: '15:00',
    end_time: '16:00',
  },
});
check('admin can create class', created.status === 201, JSON.stringify(created.data));

const removed = await call(`/api/timetable/${created.data?.id}`, {
  method: 'DELETE',
  token: adminToken,
});
check('admin can delete class', removed.status === 200);

const tempPassword = `tmp-${Date.now()}`;
const pwChange = await call('/api/auth/change-password', {
  method: 'POST',
  token: studentToken,
  body: { currentPassword: creds.studentPass, newPassword: tempPassword },
});
check('student password change', pwChange.status === 200, JSON.stringify(pwChange.data));

const reLogin = await login(creds.studentUser, tempPassword);
check('login with new password', reLogin.status === 200);

// Students may change password only once — revert via chairman reset.
const students = await call('/api/students', { token: adminToken });
const studentRow = (students.data || []).find(
  (s) => String(s.email || '').toLowerCase() === String(creds.studentUser).toLowerCase(),
);
const revert = studentRow
  ? await call(`/api/students/${studentRow.id}`, {
      method: 'PUT',
      token: adminToken,
      body: { password: creds.studentPass },
    })
  : { status: 404, data: null };
check('password reverted after smoke test', revert.status === 200, JSON.stringify(revert.data));

const loginAfterReset = await login(creds.studentUser, creds.studentPass);
check('login with seed password after reset', loginAfterReset.status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
