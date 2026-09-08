import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  projectRoot,
  findMany,
  findOne,
  insertOne,
  insertMany,
  deleteMany,
  transaction,
  isEmpty,
  bind,
  connectMongo,
  closeMongo,
  COLLECTIONS,
  caseInsensitive,
} from './db.js';
import {
  CHAIRMAN_PASSWORD,
  CHAIRMAN_USERNAME,
  STUDENT_INITIAL_PASSWORD,
  adminInitialPassword,
  normalizeAdminUsername,
  teacherInitialPassword,
} from './initialPasswords.js';

const SEED_FILE = join(projectRoot, 'data', 'seed.json');
/** Monorepo root (parent of backend/) — local-only, gitignored. */
const CREDENTIALS_FILE = join(projectRoot, '..', 'credentials.local.txt');
const HASH_ROUNDS = 10;
const DEMO_SECTIONS = ['A', 'B', 'C', 'D'];

/** Extra super-admin accounts to ensure exist. */
const DEMO_ADMIN_ACCOUNTS = [
  { username: 'superadmin@diu.demo', type: 'super_admin' },
  { username: 'admin@diu.demo', type: 'super_admin' },
];

function hash(plain) {
  return bcrypt.hashSync(plain, HASH_ROUNDS);
}

async function wipe() {
  for (const name of COLLECTIONS) {
    await deleteMany(name, {});
  }
}

function formatCredentialLine(row) {
  const login = row.login;
  const password = row.password;
  const name = row.name || login;

  if (row.role === 'teacher') {
    return `teacher (${name}): ${login} / ${password}`;
  }
  if (row.role === 'student') {
    return `student (${name}): ${login} / ${password}`;
  }
  if (String(login).toLowerCase() === 'chairman') {
    return `chairman: ${login} / ${password}`;
  }
  if (row.role === 'super_admin' || row.role === 'admin') {
    return `admin: ${login} / ${password}`;
  }
  if (row.role === 'teacher_admin') {
    return `teacher_admin (${name}): ${login} / ${password}`;
  }
  return `${row.role}: ${login} / ${password}`;
}

function writeCredentialsFile(credentials) {
  const stamp = new Date().toISOString();
  const lines = [
    `=== Seed credentials (generated ${stamp}) ===`,
    '',
    'Initial password rules:',
    `  chairman: ${CHAIRMAN_USERNAME} / ${CHAIRMAN_PASSWORD}`,
    '  teacher:  <INITIAL> / <INITIAL>123   (e.g. ZTF / ZTF123)',
    `  student:  <email> / ${STUDENT_INITIAL_PASSWORD}`,
    '  (Student/teacher may change password once; Chairman resets if forgotten.)',
    '',
    ...credentials.map(formatCredentialLine),
    '',
    'This file is gitignored (credentials.local.txt). Do not commit or share it.',
    '',
  ];
  writeFileSync(CREDENTIALS_FILE, lines.join('\n'), 'utf8');
}

function printCredentials(credentials) {
  console.log('');
  console.log('=== Seed credentials (shown once — also saved to credentials.local.txt) ===');
  console.log(`chairman: ${CHAIRMAN_USERNAME} / ${CHAIRMAN_PASSWORD}`);
  console.log('teacher:  <INITIAL> / <INITIAL>123');
  console.log(`student:  <email> / ${STUDENT_INITIAL_PASSWORD}`);
  console.log(`Wrote ${credentials.length} accounts → ${CREDENTIALS_FILE}`);
  console.log('=== End seed credentials ===');
  console.log('');
}

export async function seed({ force = false, quiet = false } = {}) {
  if (!force && !(await isEmpty())) {
    if (!quiet) console.log('Database already seeded — skipping (use --force to reseed).');
    return { skipped: true };
  }

  const raw = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
  const stats = {
    batches: 0,
    courses: 0,
    rooms: 0,
    teachers: 0,
    students: 0,
    entries: 0,
    admins: 0,
    skippedEntries: 0,
  };
  const credentials = [];

  await transaction(async () => {
    await wipe();

    const meta = raw.meta || {};
    const metaId = randomUUID();
    await insertOne('app_metadata', {
      id: metaId,
      version: bind(meta.version || '2.0.0'),
      institution_name: bind(meta.university),
      department: bind(meta.department),
      academic_year: bind('2025-2026'),
      timezone: bind(meta.tz || 'Asia/Dhaka'),
    });

    const batchDocs = (raw.batches || []).map((b) => ({
      id: b.id,
      name: bind(b.name),
      session: bind(b.session),
    }));
    if (batchDocs.length) {
      await insertMany('batches', batchDocs);
      stats.batches = batchDocs.length;
    }

    const courseDocs = (raw.courses || []).map((c) => ({
      id: randomUUID(),
      code: bind(c.code),
      title: bind(c.title),
    }));
    if (courseDocs.length) {
      await insertMany('courses', courseDocs);
      stats.courses = courseDocs.length;
    }

    const roomDocs = (raw.rooms || []).map((r) => ({
      id: r.id || r.name,
      name: bind(r.name || r.id),
    }));
    if (roomDocs.length) {
      await insertMany('rooms', roomDocs);
      stats.rooms = roomDocs.length;
    }

    const teacherDocs = [];
    for (const t of raw.teachers || []) {
      const initial = String(t.initial).toUpperCase();
      const password = teacherInitialPassword(initial);
      teacherDocs.push({
        id: t.id || randomUUID(),
        name: bind(t.name),
        initial: bind(initial),
        designation: bind(t.designation),
        phone: bind(t.phone),
        email: bind(t.email),
        home_department: bind(t.home_department),
        profile_pic: bind(t.profile_pic),
        password_hash: hash(password),
        has_changed_password: false,
      });
      credentials.push({ role: 'teacher', login: initial, password, name: t.name });
    }
    if (teacherDocs.length) {
      await insertMany('teachers', teacherDocs);
      stats.teachers = teacherDocs.length;
    }

    const seededStudents = raw.students || [];
    const studentDocs = [];
    if (seededStudents.length) {
      for (const s of seededStudents) {
        const password = STUDENT_INITIAL_PASSWORD;
        studentDocs.push({
          id: s.id || randomUUID(),
          student_id: bind(s.student_id),
          name: bind(s.name),
          batch_id: bind(s.batch_id),
          section: bind(s.section || null),
          email: bind(s.email),
          phone: bind(s.phone),
          password_hash: hash(password),
          has_changed_password: false,
        });
        credentials.push({
          role: 'student',
          login: s.email || s.student_id,
          password,
          name: s.name,
        });
      }
    } else {
      const batches = await findMany('batches', {}, { sort: { name: 1 } });
      const studentHash = hash(STUDENT_INITIAL_PASSWORD);
      let demoIndex = 0;
      batches.forEach((batch, bi) => {
        for (let n = 1; n <= 5; n += 1) {
          const email = `student${bi}${n}@diu.demo`;
          const section = DEMO_SECTIONS[demoIndex % DEMO_SECTIONS.length];
          demoIndex += 1;
          studentDocs.push({
            id: randomUUID(),
            student_id: `2102${bi}${String(n).padStart(2, '0')}`,
            name: `Demo Student ${bi}${n}`,
            batch_id: batch.id,
            section,
            email,
            phone: null,
            password_hash: studentHash,
            has_changed_password: false,
          });
          credentials.push({
            role: 'student',
            login: email,
            password: STUDENT_INITIAL_PASSWORD,
            name: `Demo Student ${bi}${n}`,
          });
        }
      });
    }
    if (studentDocs.length) {
      await insertMany('students', studentDocs);
      stats.students = studentDocs.length;
    }

    const knownBatches = new Set((await findMany('batches', {})).map((r) => r.id));
    const knownTeachers = new Set((await findMany('teachers', {})).map((r) => r.initial));
    const knownCourses = new Set((await findMany('courses', {})).map((r) => r.code));
    const knownRooms = new Set((await findMany('rooms', {})).map((r) => r.id));

    const entryDocs = [];
    for (const e of raw.timetable || []) {
      const roomId = e.room_id && knownRooms.has(e.room_id) ? e.room_id : null;
      if (
        !knownBatches.has(e.batch_id) ||
        !knownTeachers.has(e.teacher_initial) ||
        !knownCourses.has(e.course_code)
      ) {
        stats.skippedEntries += 1;
        continue;
      }
      entryDocs.push({
        id: randomUUID(),
        day: bind(e.day),
        batch_id: bind(e.batch_id),
        teacher_initial: bind(e.teacher_initial),
        course_code: bind(e.course_code),
        type: bind(e.type || 'Lecture'),
        section: bind(e.section ?? e.group ?? e.group_name),
        group_name: bind(e.group ?? e.group_name ?? e.section),
        room_id: roomId,
        mode: bind(e.mode || 'Onsite'),
        start_time: bind(String(e.start ?? e.start_time).slice(0, 5)),
        end_time: bind(String(e.end ?? e.end_time).slice(0, 5)),
        is_cancelled: Boolean(e.is_cancelled),
        cancellation_reason: bind(e.cancellation_reason),
      });
    }
    if (entryDocs.length) {
      // Chunk large timetable inserts
      const CHUNK = 200;
      for (let i = 0; i < entryDocs.length; i += CHUNK) {
        await insertMany('timetable_entries', entryDocs.slice(i, i + CHUNK));
      }
      stats.entries = entryDocs.length;
    }

    for (const a of raw.admins || []) {
      const username = normalizeAdminUsername(a.username);
      const type = a.type || 'teacher_admin';
      const password = adminInitialPassword(username, type, a.teacher_initial);
      await insertOne('admins', {
        id: a.id || randomUUID(),
        username: bind(username),
        password_hash: hash(password),
        type: bind(type),
        teacher_initial: bind(a.teacher_initial),
      });
      credentials.push({
        role: type,
        login: username,
        password,
        name: a.teacher_initial || username,
      });
      stats.admins += 1;
    }

    // Ensure Chairman exists even if seed.json omitted it.
    if (!(await findOne('admins', caseInsensitive('username', CHAIRMAN_USERNAME)))) {
      await insertOne('admins', {
        id: randomUUID(),
        username: CHAIRMAN_USERNAME,
        password_hash: hash(CHAIRMAN_PASSWORD),
        type: 'super_admin',
        teacher_initial: null,
      });
      credentials.push({
        role: 'super_admin',
        login: CHAIRMAN_USERNAME,
        password: CHAIRMAN_PASSWORD,
        name: CHAIRMAN_USERNAME,
      });
      stats.admins += 1;
    }

    for (const a of DEMO_ADMIN_ACCOUNTS) {
      const exists = await findOne('admins', caseInsensitive('username', a.username));
      if (exists) continue;
      const password = CHAIRMAN_PASSWORD;
      await insertOne('admins', {
        id: randomUUID(),
        username: a.username,
        password_hash: hash(password),
        type: a.type,
        teacher_initial: null,
      });
      credentials.push({ role: a.type, login: a.username, password, name: a.username });
      stats.admins += 1;
    }
  });

  if (!quiet) {
    console.log('Seed complete:', stats);
    printCredentials(credentials);
  }
  writeCredentialsFile(credentials);
  return { ...stats, credentials };
}

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (isMain) {
  const force = process.argv.includes('--force');
  const { config } = await import('dotenv');
  config({ path: join(projectRoot, '.env') });
  try {
    await connectMongo();
    await seed({ force });
  } finally {
    await closeMongo();
  }
}
