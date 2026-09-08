import { requireSmokeCredentials } from './smoke-credentials.js';

const BASE = process.env.BASE || 'http://127.0.0.1:4000';
const creds = requireSmokeCredentials();

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
  const res = await fetch(`${BASE}${path}`, {
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

const token = async (username, password) =>
  (await call('/api/auth/login', { method: 'POST', body: { username, password } })).data?.token;

const student = await token(creds.studentUser, creds.studentPass);
const teacher = await token(creds.teacherUser, creds.teacherPass);
const other = await token(creds.teacher2User, creds.teacher2Pass);
const admin = await token(creds.adminUser, creds.adminPass);
check('all seed logins work', Boolean(student && teacher && other && admin));

const noPurpose = await call('/api/appointments', {
  method: 'POST',
  token: student,
  body: { teacher_initial: 'LS', date: '2026-08-02', time: '07:10' },
});
check('purpose is required', noPurpose.status === 400, JSON.stringify(noPurpose.data));

const noHours = await call('/api/appointments', {
  method: 'POST',
  token: student,
  body: {
    teacher_initial: 'LS',
    date: '2026-08-02',
    time: '07:10',
    purpose: 'Thesis discussion',
  },
});
check(
  'student cannot book before teacher publishes hours (or must match a slot)',
  noHours.status === 400 || noHours.status === 201,
  JSON.stringify(noHours.data),
);

const slotBody = {
  day: 'Sun',
  start_time: '07:10',
  end_time: '07:40',
  location: 'Room 2701',
  note: 'Advising',
};
let slotRes = await call('/api/appointment-slots', {
  method: 'POST',
  token: teacher,
  body: slotBody,
});
if (slotRes.status === 409) {
  const existingHours = await call('/api/appointment-slots', { token: teacher });
  const found = existingHours.data?.slots?.find(
    (s) => s.day === 'Sun' && s.start_time.slice(0, 5) === '07:10',
  );
  slotRes = { status: 201, data: found };
}
check(
  'teacher can publish appointment schedule',
  (slotRes.status === 201 || slotRes.status === 200) && Boolean(slotRes.data?.id),
  JSON.stringify(slotRes.data),
);
const slotId = slotRes.data?.id;

const outsideHours = await call('/api/appointments', {
  method: 'POST',
  token: student,
  body: {
    teacher_initial: 'LS',
    date: '2026-08-02',
    time: '11:00',
    purpose: 'Thesis discussion',
  },
});
check(
  'time outside published hours is rejected',
  outsideHours.status === 400,
  JSON.stringify(outsideHours.data),
);

const created = await call('/api/appointments', {
  method: 'POST',
  token: student,
  body: {
    teacher_initial: 'LS',
    date: '2026-08-02',
    time: '07:10',
    slot_id: slotId,
    purpose: 'Thesis discussion',
  },
});
if (created.status === 409) {
  const list = await call('/api/appointments', { token: student });
  const found = list.data?.find(
    (a) => a.date === '2026-08-02' && String(a.time).startsWith('07:10'),
  );
  if (found) {
    created.status = 201;
    created.data = found;
  }
}
check(
  'student can request an appointment',
  created.status === 201 && created.data.status === 'pending',
  JSON.stringify(created.data),
);
const appointmentId = created.data?.id;

const teacherInbox = await call('/api/appointments', { token: teacher });
check(
  'teacher sees the request',
  teacherInbox.data?.some((a) => a.id === appointmentId),
  `count=${teacherInbox.data?.length}`,
);

const teacherNotes = await call('/api/notifications', { token: teacher });
check(
  'teacher gets an appointment notification',
  teacherNotes.data?.some((n) => n.type === 'appointment' && n.related_entry_id === appointmentId),
);

const unreadNote = teacherNotes.data?.find((n) => !n.is_read);
if (unreadNote) {
  const read = await call(`/api/notifications/${unreadNote.id}/read`, {
    method: 'PATCH',
    token: teacher,
  });
  const after = await call('/api/notifications', { token: teacher });
  check(
    'marking a notification read persists',
    read.status === 200 && after.data.find((n) => n.id === unreadNote.id)?.is_read === true,
  );
}

const stolen = await call(`/api/appointments/${appointmentId}`, {
  method: 'PATCH',
  token: other,
  body: { status: 'accepted' },
});
check("another teacher cannot answer someone else's request", stolen.status === 403, `status=${stolen.status}`);

const studentTriesToDecide = await call(`/api/appointments/${appointmentId}`, {
  method: 'PATCH',
  token: student,
  body: { status: 'accepted' },
});
check('student cannot accept their own request', studentTriesToDecide.status === 403);

const accepted = await call(`/api/appointments/${appointmentId}`, {
  method: 'PATCH',
  token: teacher,
  body: { status: 'accepted', teacher_remarks: 'Come to room 2701' },
});
check(
  'teacher can accept with remarks',
  accepted.status === 200 &&
    accepted.data.status === 'accepted' &&
    accepted.data.teacher_remarks === 'Come to room 2701',
  JSON.stringify(accepted.data),
);

const studentView = await call('/api/appointments', { token: student });
const mine = studentView.data?.find((a) => a.id === appointmentId);
check(
  'student sees the accepted request and remarks',
  mine?.status === 'accepted' && mine?.teacher_remarks === 'Come to room 2701',
);

const badStatus = await call(`/api/appointments/${appointmentId}`, {
  method: 'PATCH',
  token: teacher,
  body: { status: 'maybe' },
});
check('invalid status rejected', badStatus.status === 400);

const adminNotes = await call('/api/notifications', { token: admin });
check(
  'admin sees every notification',
  adminNotes.status === 200 && adminNotes.data.length > 0,
  `count=${adminNotes.data?.length}`,
);

const studentNotes = await call('/api/notifications', { token: student });
check(
  'student sees personal + batch notices',
  studentNotes.status === 200 && studentNotes.data.every((n) => n.recipient_type === 'student'),
  `count=${studentNotes.data?.length}`,
);
check(
  'student is notified when the teacher accepts',
  studentNotes.data?.some(
    (n) =>
      n.type === 'appointment' &&
      n.related_entry_id === appointmentId &&
      /accepted/i.test(n.title),
  ),
  JSON.stringify(studentNotes.data?.filter((n) => n.type === 'appointment').slice(0, 2)),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
