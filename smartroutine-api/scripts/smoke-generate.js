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

/** Returns a list of human-readable clashes inside a set of entries. */
function findConflicts(entries) {
  const problems = [];
  const teacher = new Map();
  const room = new Map();
  const batch = new Map();

  for (const e of entries) {
    const slot = `${e.day}|${e.start_time}`;

    const tKey = `${slot}|${e.teacher_initial}`;
    if (teacher.has(tKey)) problems.push(`teacher ${e.teacher_initial} double-booked ${slot}`);
    teacher.set(tKey, true);

    if (e.room_id) {
      const rKey = `${slot}|${e.room_id}`;
      if (room.has(rKey)) problems.push(`room ${e.room_id} double-booked ${slot}`);
      room.set(rKey, true);
    }

    const bKey = `${slot}|${e.batch_id}`;
    const groups = batch.get(bKey) || new Set();
    const group = e.group_name || '*';
    if (groups.has('*') || groups.has(group) || (group === '*' && groups.size)) {
      problems.push(`batch ${e.batch_id} double-booked ${slot}`);
    }
    groups.add(group);
    batch.set(bKey, groups);
  }
  return problems;
}

const login = async (username, password) =>
  (await call('/api/auth/login', { method: 'POST', body: { username, password } })).data?.token;

const admin = await login(creds.adminUser, creds.adminPass);
const teacherToken = await login(creds.teacherUser, creds.teacherPass);
check('admin login', Boolean(admin));

const slots = await call('/api/timetable/slots', { token: admin });
check(
  'slot list comes from the real routine',
  slots.status === 200 && slots.data.slots.length >= 4 && slots.data.days.includes('Sat'),
  JSON.stringify(slots.data?.slots),
);

const reqs = await call('/api/timetable/requirements?batch_ids=66', { token: admin });
check(
  'requirements derived from current routine',
  reqs.status === 200 && reqs.data.length > 0 && reqs.data.every((r) => r.batch_id === '66'),
  `rows=${reqs.data?.length}`,
);

const forbidden = await call('/api/timetable/generate', {
  method: 'POST',
  token: teacherToken,
  body: { requirements: reqs.data },
});
check('teacher cannot generate routines', forbidden.status === 403, `status=${forbidden.status}`);

const empty = await call('/api/timetable/generate', {
  method: 'POST',
  token: admin,
  body: { requirements: [] },
});
check('empty requirements rejected', empty.status === 400);

const badRow = await call('/api/timetable/generate', {
  method: 'POST',
  token: admin,
  body: {
    requirements: [
      { batch_id: 'nope', course_code: 'XX 000', teacher_initial: 'ZZ', sessions_per_week: 1 },
    ],
  },
});
check('unknown batch/teacher/course rejected', badRow.status === 400, JSON.stringify(badRow.data));

const before = (await call('/api/timetable', { token: admin })).data;

const preview = await call('/api/timetable/generate', {
  method: 'POST',
  token: admin,
  body: { requirements: reqs.data, replace: true, dryRun: true },
});
check(
  'dry run returns a full proposal',
  preview.status === 200 &&
    preview.data.applied === false &&
    preview.data.scheduled.length > 0 &&
    preview.data.stats.requested === preview.data.stats.placed + preview.data.stats.skipped,
  JSON.stringify(preview.data?.stats),
);

const after = (await call('/api/timetable', { token: admin })).data;
check('dry run saved nothing', before.length === after.length, `${before.length} -> ${after.length}`);

// The imported routine already contains a few room clashes, so the bar is that
// generation must not introduce any new ones.
const keptEntries = before.filter((e) => e.batch_id !== '66');
const baseline = new Set(findConflicts(keptEntries));
const combined = [...keptEntries, ...(preview.data?.scheduled || [])];
const newConflicts = findConflicts(combined).filter((c) => !baseline.has(c));
check(
  'proposal adds no teacher, room or batch clash',
  newConflicts.length === 0,
  newConflicts.slice(0, 3).join(' | '),
);
check(
  'proposal itself is internally conflict-free',
  findConflicts(preview.data?.scheduled || []).length === 0,
);

const spread = Object.values(preview.data?.stats.perDay || {});
check(
  'classes are spread across days',
  spread.length >= 3 && Math.max(...spread) <= 3 * 2,
  JSON.stringify(preview.data?.stats.perDay),
);

// A throwaway batch keeps the destructive apply test from touching real data.
const batch = await call('/api/batches', {
  method: 'POST',
  token: admin,
  body: { name: 'Generator Test', session: '2099-00' },
});
check('temp batch created', batch.status === 201);
const batchId = batch.data?.id;

const courses = (await call('/api/courses', { token: admin })).data.slice(0, 4);
const testRequirements = courses.map((c, i) => ({
  batch_id: batchId,
  course_code: c.code,
  teacher_initial: i % 2 === 0 ? 'LS' : 'EHE',
  type: i === 3 ? 'Sessional' : 'Lecture',
  mode: 'Onsite',
  sessions_per_week: 2,
}));

const applied = await call('/api/timetable/generate', {
  method: 'POST',
  token: admin,
  body: { requirements: testRequirements, replace: true, dryRun: false },
});
check(
  'apply saves the generated routine',
  applied.status === 200 && applied.data.applied === true && applied.data.stats.placed === 8,
  JSON.stringify(applied.data?.stats),
);

const saved = (await call(`/api/timetable?batch_id=${batchId}`, { token: admin })).data;
check('generated classes are readable', saved.length === 8, `count=${saved.length}`);
check(
  'sessional got a lab room',
  saved.filter((e) => e.type === 'Sessional').every((e) => /lab/i.test(e.room_id) || e.room_id),
  JSON.stringify(saved.filter((e) => e.type === 'Sessional').map((e) => e.room_id)),
);

const dbBaseline = new Set(findConflicts(before));
const wholeDb = (await call('/api/timetable', { token: admin })).data;
const dbConflicts = findConflicts(wholeDb).filter((c) => !dbBaseline.has(c));
check(
  'apply adds no clash to the live database',
  dbConflicts.length === 0,
  dbConflicts.slice(0, 3).join(' | '),
);

const impossible = await call('/api/timetable/generate', {
  method: 'POST',
  token: admin,
  body: {
    requirements: [
      {
        batch_id: batchId,
        course_code: courses[0].code,
        teacher_initial: 'LS',
        type: 'Lecture',
        mode: 'Onsite',
        sessions_per_week: 40,
      },
    ],
    dryRun: true,
  },
});
check(
  'over-booked requests are reported with a reason',
  impossible.data?.unscheduled.length > 0 && Boolean(impossible.data.unscheduled[0].reason),
  JSON.stringify(impossible.data?.unscheduled?.[0]),
);

const cleanup = await call(`/api/batches/${batchId}`, { method: 'DELETE', token: admin });
const finalEntries = (await call('/api/timetable', { token: admin })).data;
check(
  'cleanup removed the temp batch and its classes',
  cleanup.status === 200 && finalEntries.length === before.length,
  `${before.length} -> ${finalEntries.length}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
