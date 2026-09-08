import { MongoClient } from 'mongodb';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, '..');

/** @type {import('mongodb').MongoClient | null} */
let client = null;
/** @type {import('mongodb').Db | null} */
let db = null;

export const COLLECTIONS = [
  'admins',
  'teachers',
  'batches',
  'courses',
  'rooms',
  'students',
  'timetable_entries',
  'notifications',
  'push_subscriptions',
  'google_calendar_links',
  'google_calendar_events',
  'appointments',
  'appointment_slots',
  'app_metadata',
  'audit_events',
  'semesters',
  'timetable_snapshots',
  'conflict_negotiations',
  'attendance_sessions',
  'attendance_records',
  'room_presence',
  'student_preferences',
  'nl_command_log',
];

export function nowIso() {
  return new Date().toISOString();
}

/** Normalize undefined → null for inserts (Mongo rejects undefined in some drivers). */
export function bind(value) {
  if (value === undefined) return null;
  return value;
}

export function getDb() {
  if (!db) throw new Error('MongoDB is not connected — call connectMongo() first');
  return db;
}

export function col(name) {
  return getDb().collection(name);
}

export async function connectMongo() {
  if (db) return db;

  const uri = (process.env.MONGODB_URI || '').trim();
  if (!uri) {
    throw new Error(
      'MONGODB_URI is missing. Set it in backend/.env (e.g. mongodb://127.0.0.1:27017)',
    );
  }
  const dbName = (process.env.MONGODB_DB || 'smartroutine').trim() || 'smartroutine';

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes();
  return db;
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

async function ensureIndexes() {
  await col('admins').createIndex({ username: 1 }, { unique: true });
  await col('teachers').createIndex({ initial: 1 }, { unique: true });
  await col('batches').createIndex({ name: 1, session: 1 }, { unique: true });
  await col('courses').createIndex({ code: 1 }, { unique: true });
  await col('rooms').createIndex({ name: 1 }, { unique: true });
  await col('students').createIndex({ student_id: 1 }, { unique: true });
  await col('students').createIndex({ batch_id: 1 });
  await col('students').createIndex({ email: 1 });
  await col('timetable_entries').createIndex({ day: 1 });
  await col('timetable_entries').createIndex({ batch_id: 1 });
  await col('timetable_entries').createIndex({ teacher_initial: 1 });
  await col('timetable_entries').createIndex({ room_id: 1 });
  await col('notifications').createIndex({ recipient_type: 1, recipient_id: 1 });
  await col('push_subscriptions').createIndex({ endpoint: 1 }, { unique: true });
  await col('push_subscriptions').createIndex({ user_id: 1 });
  await col('google_calendar_events').createIndex(
    { user_id: 1, timetable_entry_id: 1 },
    { unique: true },
  );
  await col('appointment_slots').createIndex(
    { teacher_initial: 1, day: 1, start_time: 1, end_time: 1 },
    { unique: true },
  );
  await col('appointment_slots').createIndex({ teacher_initial: 1 });
  await col('appointments').createIndex({ teacher_initial: 1, date: 1, time: 1 });
  await col('attendance_sessions').createIndex({ token: 1 }, { unique: true });
  await col('attendance_records').createIndex(
    { session_id: 1, student_id: 1 },
    { unique: true },
  );
  await col('audit_events').createIndex({ created_at: -1 });
}

export async function findMany(name, filter = {}, options = {}) {
  const { sort, limit, projection } = options;
  let cursor = col(name).find(filter, projection ? { projection } : undefined);
  if (sort) cursor = cursor.sort(sort);
  if (limit) cursor = cursor.limit(limit);
  return cursor.toArray();
}

export async function findOne(name, filter = {}, options = {}) {
  return col(name).findOne(filter, options);
}

export async function insertOne(name, doc) {
  const payload = { ...doc };
  if (payload.id && !payload._id) payload._id = payload.id;
  const result = await col(name).insertOne(payload);
  return result;
}

export async function insertMany(name, docs) {
  if (!docs.length) return { insertedCount: 0 };
  const payload = docs.map((d) => {
    const row = { ...d };
    if (row.id && !row._id) row._id = row.id;
    return row;
  });
  return col(name).insertMany(payload, { ordered: false });
}

export async function updateOne(name, filter, update, options = {}) {
  return col(name).updateOne(filter, update, options);
}

export async function updateMany(name, filter, update, options = {}) {
  return col(name).updateMany(filter, update, options);
}

export async function replaceOne(name, filter, doc, options = {}) {
  const payload = { ...doc };
  if (payload.id && !payload._id) payload._id = payload.id;
  return col(name).replaceOne(filter, payload, options);
}

export async function deleteOne(name, filter) {
  return col(name).deleteOne(filter);
}

export async function deleteMany(name, filter = {}) {
  return col(name).deleteMany(filter);
}

export async function count(name, filter = {}) {
  return col(name).countDocuments(filter);
}

/** Prefer transactions on Atlas; fall back to sequential on standalone. */
export async function transaction(fn) {
  const database = getDb();
  let session;
  try {
    session = client.startSession();
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/Transaction numbers|replica set|transactions are not supported/i.test(msg)) {
      return fn(null);
    }
    throw err;
  } finally {
    if (session) await session.endSession().catch(() => undefined);
  }
}

export async function isEmpty() {
  return (await count('teachers')) === 0;
}

/** Escape regex special chars for case-insensitive login lookups. */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function caseInsensitive(field, value) {
  return { [field]: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } };
}

/** Deprecated SQLite path — kept so old imports fail clearly if leftover. */
export const dbPath = null;

