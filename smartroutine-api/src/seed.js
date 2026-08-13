import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, projectRoot, run, get, all, transaction, isEmpty, bind } from './db.js';
import {
  CHAIRMAN_PASSWORD,
  CHAIRMAN_USERNAME,
  STUDENT_INITIAL_PASSWORD,
  adminInitialPassword,
  normalizeAdminUsername,
  teacherInitialPassword,
} from './initialPasswords.js';

const SEED_FILE = join(projectRoot, 'data', 'seed.json');
/** Monorepo root (parent of smartroutine-api/) — local-only, gitignored. */
const CREDENTIALS_FILE = join(projectRoot, '..', 'credentials.local.txt');
const HASH_ROUNDS = 10;

/** Extra super-admin accounts to ensure exist. */
const DEMO_ADMIN_ACCOUNTS = [
  { username: 'superadmin@diu.demo', type: 'super_admin' },
  { username: 'admin@diu.demo', type: 'super_admin' },
];

function hash(plain) {
  return bcrypt.hashSync(plain, HASH_ROUNDS);
}

function wipe() {
  const tables = [
    'notifications',
    'appointments',
    'timetable_entries',
    'students',
    'admins',
    'teachers',
    'courses',
    'rooms',
    'batches',
    'app_metadata',
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
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

export function seed({ force = false, quiet = false } = {}) {
  if (!force && !isEmpty()) {
    if (!quiet) console.log('Database already seeded — skipping (use --force to reseed).');
    return { skipped: true };
  }

  const raw = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
  const stats = { batches: 0, courses: 0, rooms: 0, teachers: 0, students: 0, entries: 0, admins: 0, skippedEntries: 0 };
  const credentials = [];

  transaction(() => {
    wipe();

    const meta = raw.meta || {};
    run(
      `INSERT INTO app_metadata (id, version, institution_name, department, academic_year, timezone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        bind(meta.version || '2.0.0'),
        bind(meta.university),
        bind(meta.department),
        bind('2025-2026'),
        bind(meta.tz || 'Asia/Dhaka'),
      ],
    );

    for (const b of raw.batches || []) {
      run('INSERT INTO batches (id, name, session) VALUES (?, ?, ?)', [
        bind(b.id),
        bind(b.name),
        bind(b.session),
      ]);
      stats.batches += 1;
    }

    for (const c of raw.courses || []) {
      run('INSERT INTO courses (id, code, title) VALUES (?, ?, ?)', [
        randomUUID(),
        bind(c.code),
        bind(c.title),
      ]);
      stats.courses += 1;
    }

    for (const r of raw.rooms || []) {
      run('INSERT INTO rooms (id, name) VALUES (?, ?)', [
        bind(r.id || r.name),
        bind(r.name || r.id),
      ]);
      stats.rooms += 1;
    }

    for (const t of raw.teachers || []) {
      const initial = String(t.initial).toUpperCase();
      const password = teacherInitialPassword(initial);
      run(
        `INSERT INTO teachers (id, name, initial, designation, phone, email, home_department, profile_pic, password_hash, has_changed_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          bind(t.id || randomUUID()),
          bind(t.name),
          bind(initial),
          bind(t.designation),
          bind(t.phone),
          bind(t.email),
          bind(t.home_department),
          bind(t.profile_pic),
          hash(password),
        ],
      );
      credentials.push({ role: 'teacher', login: initial, password, name: t.name });
      stats.teachers += 1;
    }

    const seededStudents = raw.students || [];
    if (seededStudents.length) {
      for (const s of seededStudents) {
        const password = STUDENT_INITIAL_PASSWORD;
        run(
          `INSERT INTO students (id, student_id, name, batch_id, email, phone, password_hash, has_changed_password)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            bind(s.id || randomUUID()),
            bind(s.student_id),
            bind(s.name),
            bind(s.batch_id),
            bind(s.email),
            bind(s.phone),
            hash(password),
          ],
        );
        credentials.push({
          role: 'student',
          login: s.email || s.student_id,
          password,
          name: s.name,
        });
        stats.students += 1;
      }
    } else {
      const batches = all('SELECT id, name FROM batches ORDER BY rowid');
      const studentHash = hash(STUDENT_INITIAL_PASSWORD);
      batches.forEach((batch, bi) => {
        for (let n = 1; n <= 5; n += 1) {
          const email = `student${bi}${n}@diu.demo`;
          run(
            `INSERT INTO students (id, student_id, name, batch_id, email, phone, password_hash, has_changed_password)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
            [
              randomUUID(),
              `2102${bi}${String(n).padStart(2, '0')}`,
              `Demo Student ${bi}${n}`,
              batch.id,
              email,
              null,
              studentHash,
            ],
          );
          credentials.push({
            role: 'student',
            login: email,
            password: STUDENT_INITIAL_PASSWORD,
            name: `Demo Student ${bi}${n}`,
          });
          stats.students += 1;
        }
      });
    }

    const knownBatches = new Set(all('SELECT id FROM batches').map((r) => r.id));
    const knownTeachers = new Set(all('SELECT initial FROM teachers').map((r) => r.initial));
    const knownCourses = new Set(all('SELECT code FROM courses').map((r) => r.code));
    const knownRooms = new Set(all('SELECT id FROM rooms').map((r) => r.id));

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
      run(
        `INSERT INTO timetable_entries
          (id, day, batch_id, teacher_initial, course_code, type, group_name, room_id, mode, start_time, end_time, is_cancelled, cancellation_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          bind(e.day),
          bind(e.batch_id),
          bind(e.teacher_initial),
          bind(e.course_code),
          bind(e.type || 'Lecture'),
          bind(e.group ?? e.group_name),
          roomId,
          bind(e.mode || 'Onsite'),
          bind(String(e.start ?? e.start_time).slice(0, 5)),
          bind(String(e.end ?? e.end_time).slice(0, 5)),
          bind(e.is_cancelled),
          bind(e.cancellation_reason),
        ],
      );
      stats.entries += 1;
    }

    for (const a of raw.admins || []) {
      const username = normalizeAdminUsername(a.username);
      const type = a.type || 'teacher_admin';
      const password = adminInitialPassword(username, type, a.teacher_initial);
      run(
        'INSERT INTO admins (id, username, password_hash, type, teacher_initial) VALUES (?, ?, ?, ?, ?)',
        [
          bind(a.id || randomUUID()),
          bind(username),
          hash(password),
          bind(type),
          bind(a.teacher_initial),
        ],
      );
      credentials.push({
        role: type,
        login: username,
        password,
        name: a.teacher_initial || username,
      });
      stats.admins += 1;
    }

    // Ensure Chairman exists even if seed.json omitted it.
    if (!get('SELECT id FROM admins WHERE lower(username) = lower(?)', [CHAIRMAN_USERNAME])) {
      run(
        'INSERT INTO admins (id, username, password_hash, type, teacher_initial) VALUES (?, ?, ?, ?, NULL)',
        [randomUUID(), CHAIRMAN_USERNAME, hash(CHAIRMAN_PASSWORD), 'super_admin'],
      );
      credentials.push({
        role: 'super_admin',
        login: CHAIRMAN_USERNAME,
        password: CHAIRMAN_PASSWORD,
        name: CHAIRMAN_USERNAME,
      });
      stats.admins += 1;
    }

    for (const a of DEMO_ADMIN_ACCOUNTS) {
      const exists = get('SELECT id FROM admins WHERE lower(username) = lower(?)', [a.username]);
      if (exists) continue;
      const password = CHAIRMAN_PASSWORD;
      run(
        'INSERT INTO admins (id, username, password_hash, type, teacher_initial) VALUES (?, ?, ?, ?, NULL)',
        [randomUUID(), a.username, hash(password), a.type],
      );
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

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const force = process.argv.includes('--force');
  seed({ force });
}
