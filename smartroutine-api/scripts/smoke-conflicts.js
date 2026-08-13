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

const login = async (username, password) =>
  (await call('/api/auth/login', { method: 'POST', body: { username, password } })).data?.token;

const admin = await login(creds.adminUser, creds.adminPass);
const teacher = await login(creds.teacherUser, creds.teacherPass);
check('admin login', Boolean(admin));
check('teacher login', Boolean(teacher));

const forbidden = await call('/api/timetable/conflicts', { token: teacher });
check('conflict report is admin only', forbidden.status === 403, `status=${forbidden.status}`);

const audit = await call('/api/timetable/conflicts', { token: admin });
const baselineConflicts = audit.data?.summary?.total ?? 0;
check(
  'conflict audit loads (Summer 2026 source may include known clashes)',
  audit.status === 200 && typeof baselineConflicts === 'number',
  JSON.stringify(audit.data?.summary),
);
if (baselineConflicts > 0) {
  console.log(`NOTE  source routine has ${baselineConflicts} pre-existing clash(es)`);
}

const entries = (await call('/api/timetable', { token: admin })).data;
const teachers = (await call('/api/teachers', { token: admin })).data;
const batches = (await call('/api/batches', { token: admin })).data;
const rooms = (await call('/api/rooms', { token: admin })).data;

// Prefer a lightly loaded slot so free-room / free-teacher picks succeed.
let target = null;
let slot = null;
let atSlot = [];
let freeRoom = null;
let freeTeacher = null;
let freeBatch = null;
for (const cand of entries.filter((e) => e.room_id && !e.is_cancelled)) {
  const trySlot = { day: cand.day, start_time: cand.start_time, end_time: cand.end_time };
  const busy = entries.filter(
    (e) =>
      !e.is_cancelled &&
      e.day === trySlot.day &&
      e.start_time < trySlot.end_time &&
      e.end_time > trySlot.start_time,
  );
  const freeRooms = (
    await call(
      `/api/timetable/free-rooms?day=${trySlot.day}&start=${trySlot.start_time}&end=${trySlot.end_time}`,
      { token: admin },
    )
  ).data?.free;
  const roomId = freeRooms?.[0]?.id;
  const teacherInitial = teachers.find(
    (t) => !busy.some((e) => e.teacher_initial === t.initial),
  )?.initial;
  const batchId = batches.find(
    (b) => b.id !== cand.batch_id && !busy.some((e) => e.batch_id === b.id),
  )?.id;
  if (roomId && teacherInitial && batchId) {
    target = cand;
    slot = trySlot;
    atSlot = busy;
    freeRoom = roomId;
    freeTeacher = teacherInitial;
    freeBatch = batchId;
    break;
  }
}
check(
  'found a free room, teacher and batch for the test slot',
  Boolean(target && freeRoom && freeTeacher && freeBatch),
  `room=${freeRoom} teacher=${freeTeacher} batch=${freeBatch} rooms=${rooms?.length}`,
);

const draft = (patch) => ({
  ...slot,
  batch_id: freeBatch,
  teacher_initial: freeTeacher,
  course_code: target.course_code,
  type: 'Lecture',
  mode: 'Onsite',
  group_name: null,
  room_id: freeRoom,
  is_cancelled: false,
  cancellation_reason: null,
  ...patch,
});

const roomClash = await call('/api/timetable', {
  method: 'POST',
  token: admin,
  body: draft({ room_id: target.room_id }),
});
check(
  'double booking a room is refused',
  roomClash.status === 409 && roomClash.data.conflicts?.[0]?.kind === 'room',
  JSON.stringify(roomClash.data),
);

const teacherClash = await call('/api/timetable', {
  method: 'POST',
  token: admin,
  body: draft({ teacher_initial: target.teacher_initial }),
});
check(
  'double booking a teacher is refused',
  teacherClash.status === 409 && teacherClash.data.conflicts?.[0]?.kind === 'teacher',
  JSON.stringify(teacherClash.data?.conflicts?.[0]),
);

const batchClash = await call('/api/timetable', {
  method: 'POST',
  token: admin,
  body: draft({ batch_id: target.batch_id }),
});
check(
  'giving a batch two classes at once is refused',
  batchClash.status === 409 && batchClash.data.conflicts?.[0]?.kind === 'batch',
  JSON.stringify(batchClash.data?.conflicts?.[0]),
);

const stillClean = await call('/api/timetable/conflicts', { token: admin });
check(
  'refused classes were not saved',
  stillClean.data.summary.total === baselineConflicts,
  JSON.stringify(stillClean.data?.summary),
);

// Parallel lab groups of one batch are legitimate and must stay allowed.
const grouped = entries.find((e) => e.group_name && !e.is_cancelled);
if (grouped) {
  const groupSlot = {
    day: grouped.day,
    start_time: grouped.start_time,
    end_time: grouped.end_time,
  };
  const busyThen = entries.filter(
    (e) =>
      !e.is_cancelled &&
      e.day === groupSlot.day &&
      e.start_time < groupSlot.end_time &&
      e.end_time > groupSlot.start_time,
  );
  const room = (
    await call(
      `/api/timetable/free-rooms?day=${groupSlot.day}&start=${groupSlot.start_time}&end=${groupSlot.end_time}`,
      { token: admin },
    )
  ).data.free[0]?.id;
  const initial = teachers.find((t) => !busyThen.some((e) => e.teacher_initial === t.initial))
    ?.initial;

  const parallel = await call('/api/timetable', {
    method: 'POST',
    token: admin,
    body: {
      ...groupSlot,
      batch_id: grouped.batch_id,
      teacher_initial: initial,
      course_code: grouped.course_code,
      type: 'Sessional',
      mode: 'Onsite',
      group_name: 'G9',
      room_id: room,
      is_cancelled: false,
      cancellation_reason: null,
    },
  });
  check(
    'a second lab group in the same slot is allowed',
    parallel.status === 201,
    JSON.stringify(parallel.data),
  );
  if (parallel.data?.id) {
    await call(`/api/timetable/${parallel.data.id}`, { method: 'DELETE', token: admin });
  }
}

const forced = await call('/api/timetable', {
  method: 'POST',
  token: admin,
  body: draft({ room_id: target.room_id, force: true }),
});
check('an admin can override with force', forced.status === 201, JSON.stringify(forced.data));

const withForced = await call('/api/timetable/conflicts', { token: admin });
check(
  'the forced clash shows up in the report',
  withForced.data.summary.total === baselineConflicts + 1 && withForced.data.summary.room >= 1,
  JSON.stringify(withForced.data?.summary),
);
check(
  'the report names both classes and the room',
  withForced.data.conflicts.some(
    (c) => c.kind === 'room' && c.resource === target.room_id && c.entries?.length === 2,
  ),
  JSON.stringify(withForced.data?.conflicts?.map((c) => c.message)),
);

await call(`/api/timetable/${forced.data.id}`, { method: 'DELETE', token: admin });
const cleaned = await call('/api/timetable/conflicts', { token: admin });
check(
  'removing the class clears the report',
  cleaned.data.summary.total === baselineConflicts,
  JSON.stringify(cleaned.data?.summary),
);

const clean = await call('/api/timetable', { method: 'POST', token: admin, body: draft({}) });
check('a genuinely free slot still saves', clean.status === 201, JSON.stringify(clean.data));
if (clean.data?.id) {
  await call(`/api/timetable/${clean.data.id}`, { method: 'DELETE', token: admin });
}

// A teacher may not push their own class into a clash, not even with force.
const mine = entries.filter((e) => e.teacher_initial === 'LS' && !e.is_cancelled);
const [first, second] = mine;
const teacherMove = await call(`/api/timetable/${first.id}`, {
  method: 'PATCH',
  token: teacher,
  body: {
    day: second.day,
    start_time: second.start_time,
    end_time: second.end_time,
    force: true,
  },
});
check(
  'teacher cannot reschedule into a clash even with force',
  teacherMove.status === 409,
  JSON.stringify(teacherMove.data),
);

const unchanged = (await call(`/api/timetable?day=${first.day}`, { token: admin })).data.find(
  (e) => e.id === first.id,
);
check('the blocked reschedule left the class untouched', Boolean(unchanged));

const cancelled = await call(`/api/timetable/${first.id}`, {
  method: 'PATCH',
  token: teacher,
  body: { is_cancelled: true, cancellation_reason: 'conflict test' },
});
check('cancelling is unaffected by the guard', cancelled.status === 200);
const restored = await call(`/api/timetable/${first.id}`, {
  method: 'PATCH',
  token: teacher,
  body: { is_cancelled: false, cancellation_reason: null },
});
check('restoring a clash-free class works', restored.status === 200);

const finalAudit = await call('/api/timetable/conflicts', { token: admin });
check(
  'routine conflicts return to baseline at the end of the run',
  finalAudit.data.summary.total === baselineConflicts,
  JSON.stringify(finalAudit.data?.summary),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
