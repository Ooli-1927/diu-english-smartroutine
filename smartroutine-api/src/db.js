import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, '..');
export const dbPath = process.env.DB_PATH || join(projectRoot, 'data', 'smartroutine.db');

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('super_admin', 'teacher_admin')),
  teacher_initial TEXT,
  profile_pic TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initial TEXT UNIQUE NOT NULL,
  designation TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  home_department TEXT NOT NULL,
  profile_pic TEXT,
  password_hash TEXT,
  has_changed_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  session TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (name, session)
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  student_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  section TEXT,
  email TEXT,
  phone TEXT,
  profile_pic TEXT,
  password_hash TEXT,
  has_changed_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timetable_entries (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL CHECK (day IN ('Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri')),
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  teacher_initial TEXT NOT NULL REFERENCES teachers(initial) ON DELETE CASCADE,
  course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('Lecture', 'Tutorial', 'Sessional', 'Online')),
  section TEXT,
  group_name TEXT,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('Onsite', 'Online', 'Offline')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  cancellation_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('super_admin', 'student', 'teacher')),
  recipient_id TEXT NOT NULL,
  related_entry_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS google_calendar_links (
  user_id TEXT PRIMARY KEY,
  user_role TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  expiry TEXT,
  calendar_id TEXT,
  email TEXT,
  last_sync_at TEXT,
  last_sync_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS google_calendar_events (
  user_id TEXT NOT NULL,
  timetable_entry_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  PRIMARY KEY (user_id, timetable_entry_id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  teacher_initial TEXT NOT NULL REFERENCES teachers(initial) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  teacher_remarks TEXT,
  slot_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointment_slots (
  id TEXT PRIMARY KEY,
  teacher_initial TEXT NOT NULL REFERENCES teachers(initial) ON DELETE CASCADE,
  day TEXT NOT NULL CHECK (day IN ('Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  location TEXT,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_metadata (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  institution_name TEXT,
  department TEXT,
  academic_year TEXT,
  timezone TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_role TEXT,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT,
  before_json TEXT,
  after_json TEXT,
  meta_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS semesters (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  academic_year TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timetable_snapshots (
  id TEXT PRIMARY KEY,
  semester_id TEXT REFERENCES semesters(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conflict_negotiations (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'expired')),
  kind TEXT,
  resource TEXT,
  message TEXT,
  entry_a_id TEXT,
  entry_b_id TEXT,
  initiator_role TEXT,
  initiator_id TEXT,
  proposal_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  opened_by TEXT,
  expires_at TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  student_name TEXT,
  scanned_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS room_presence (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('free', 'busy', 'full', 'unknown')),
  note TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_preferences (
  student_id TEXT PRIMARY KEY,
  avoid_early INTEGER NOT NULL DEFAULT 0,
  prefer_gaps INTEGER NOT NULL DEFAULT 1,
  max_daily INTEGER NOT NULL DEFAULT 4,
  prefer_online INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nl_command_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  text TEXT NOT NULL,
  intent TEXT,
  plan_json TEXT,
  executed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable_entries(day);
CREATE INDEX IF NOT EXISTS idx_timetable_batch ON timetable_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable_entries(teacher_initial);
CREATE INDEX IF NOT EXISTS idx_timetable_room ON timetable_entries(room_id);
CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_user ON google_calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_attendance_token ON attendance_sessions(token);
CREATE INDEX IF NOT EXISTS idx_appointment_slots_teacher ON appointment_slots(teacher_initial);
CREATE INDEX IF NOT EXISTS idx_appointments_teacher_date ON appointments(teacher_initial, date, time);
`;

export function initSchema() {
  db.exec(SCHEMA);
  for (const sql of [
    'ALTER TABLE students ADD COLUMN profile_pic TEXT',
    'ALTER TABLE admins ADD COLUMN profile_pic TEXT',
    'ALTER TABLE rooms ADD COLUMN capacity INTEGER',
    'ALTER TABLE rooms ADD COLUMN building TEXT',
    'ALTER TABLE rooms ADD COLUMN floor TEXT',
    'ALTER TABLE appointments ADD COLUMN slot_id TEXT',
    'ALTER TABLE students ADD COLUMN section TEXT',
    'ALTER TABLE timetable_entries ADD COLUMN section TEXT',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_slots_unique
     ON appointment_slots(teacher_initial, day, start_time, end_time)`,
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
}

initSchema();

export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function isEmpty() {
  const row = get('SELECT COUNT(*) AS n FROM teachers');
  return !row || row.n === 0;
}

/** node:sqlite only binds null/number/string/bigint/Buffer, so booleans and undefined are normalized here. */
export function bind(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}
