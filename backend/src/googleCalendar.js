import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import {
  bind,
  deleteMany,
  findMany,
  findOne,
  insertOne,
  nowIso,
  updateOne,
} from './db.js';

const CALENDAR_NAME = 'DIU SmartRoutine';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

const RRULE_BYDAY = {
  Sun: 'SU',
  Mon: 'MO',
  Tue: 'TU',
  Wed: 'WE',
  Thu: 'TH',
  Fri: 'FR',
  Sat: 'SA',
};

const JS_WEEKDAY = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const JWT_SECRET = process.env.JWT_SECRET || 'smartroutine-dev-secret-change-me';

export function isGoogleCalendarConfigured() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return Boolean(id && secret && !id.includes('your-'));
}

function redirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    'http://localhost:4000/api/google/callback'
  );
}

function publicAppUrl() {
  return (
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    'http://localhost:5173'
  );
}

async function timezone() {
  const meta = await findOne('app_metadata', {});
  return meta?.timezone || 'Asia/Dhaka';
}

function createOAuthClient() {
  if (!isGoogleCalendarConfigured()) {
    const err = new Error('Google Calendar is not configured');
    err.status = 503;
    throw err;
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID.trim(),
    process.env.GOOGLE_CLIENT_SECRET.trim(),
    redirectUri(),
  );
}

/** Roles that may connect Google Calendar. */
export function canConnectGoogle(session) {
  if (!session) return false;
  if (session.role === 'student') return true;
  if (session.role === 'teacher' || session.role === 'teacher_admin') {
    return Boolean(session.teacherInitial);
  }
  return false;
}

function profilePathForRole(role) {
  if (role === 'student') return '/student/profile';
  return '/teacher/profile';
}

export function buildAuthUrl(session) {
  const client = createOAuthClient();
  const state = jwt.sign(
    {
      purpose: 'google_calendar',
      userId: session.id,
      role: session.role,
      teacherInitial: session.teacherInitial || null,
    },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

export function verifyOAuthState(state) {
  try {
    const payload = jwt.verify(state, JWT_SECRET);
    if (payload.purpose !== 'google_calendar' || !payload.userId) return null;
    return payload;
  } catch {
    return null;
  }
}

export function callbackRedirect(role, query = {}) {
  const base = publicAppUrl().replace(/\/$/, '');
  const path = profilePathForRole(role);
  const qs = new URLSearchParams(query).toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

function sliceTime(t) {
  return String(t || '').slice(0, 5);
}

function nextOccurrenceOfDay(day, from = new Date()) {
  const target = JS_WEEKDAY[day];
  if (target === undefined) return from;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const delta = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function localDateTimeIso(date, timeHm) {
  const [hh, mm] = sliceTime(timeHm).split(':').map(Number);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const h = String(Number.isFinite(hh) ? hh : 0).padStart(2, '0');
  const min = String(Number.isFinite(mm) ? mm : 0).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:00`;
}

async function saveLinkTokens(userId, userRole, tokens, email) {
  const existing = await findOne('google_calendar_links', { user_id: userId });
  const expiry = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : null;
  const refresh = tokens.refresh_token;
  if (existing) {
    const $set = {
      user_role: bind(userRole),
      access_token: bind(tokens.access_token || null),
      expiry: bind(expiry),
      last_sync_error: null,
      updated_at: nowIso(),
    };
    if (refresh) $set.refresh_token = bind(refresh);
    if (email) $set.email = bind(email);
    await updateOne('google_calendar_links', { user_id: userId }, { $set });
  } else {
    if (!refresh) {
      const err = new Error(
        'Google did not return a refresh token. Disconnect the app in Google Account permissions and try Connect again.',
      );
      err.status = 400;
      throw err;
    }
    await insertOne('google_calendar_links', {
      id: userId,
      user_id: userId,
      user_role: bind(userRole),
      refresh_token: bind(refresh),
      access_token: bind(tokens.access_token || null),
      expiry: bind(expiry),
      email: bind(email || null),
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
}

async function oauthClientForUser(userId) {
  const link = await findOne('google_calendar_links', { user_id: userId });
  if (!link) {
    const err = new Error('Google Calendar is not connected');
    err.status = 400;
    throw err;
  }
  const client = createOAuthClient();
  client.setCredentials({
    refresh_token: link.refresh_token,
    access_token: link.access_token || undefined,
    expiry_date: link.expiry ? Date.parse(link.expiry) : undefined,
  });
  client.on('tokens', (tokens) => {
    void saveLinkTokens(
      userId,
      link.user_role,
      {
        ...tokens,
        refresh_token: tokens.refresh_token || link.refresh_token,
      },
      link.email,
    ).catch((e) => {
      console.warn('Google token refresh save failed:', e?.message || e);
    });
  });
  return { client, link };
}

async function ensureRoutineCalendar(calendar, userId, link) {
  if (link.calendar_id) {
    try {
      await calendar.calendars.get({ calendarId: link.calendar_id });
      return link.calendar_id;
    } catch {
      /* recreate below */
    }
  }

  const list = await calendar.calendarList.list({ maxResults: 250 });
  const found = (list.data.items || []).find(
    (c) => c.summary === CALENDAR_NAME && !c.deleted,
  );
  let calendarId = found?.id;
  if (!calendarId) {
    const created = await calendar.calendars.insert({
      requestBody: {
        summary: CALENDAR_NAME,
        description: 'Classes synced one-way from DIU SmartRoutine',
        timeZone: await timezone(),
      },
    });
    calendarId = created.data.id;
  }

  await updateOne(
    'google_calendar_links',
    { user_id: userId },
    { $set: { calendar_id: bind(calendarId), updated_at: nowIso() } },
  );
  return calendarId;
}

async function entriesForUser(link) {
  if (link.user_role === 'student') {
    const student = await findOne('students', { id: link.user_id });
    if (!student?.batch_id) return [];
    const rows = await findMany(
      'timetable_entries',
      { batch_id: student.batch_id },
      { sort: { day: 1, start_time: 1 } },
    );
    if (!student.section) return rows;
    return rows.filter(
      (e) => !e.section || e.section === student.section || e.group_name === student.section,
    );
  }

  let teacher = await findOne('teachers', { id: link.user_id });
  if (!teacher) {
    teacher = await findOne('teachers', { initial: link.user_id });
  }
  if (!teacher?.initial) return [];
  return findMany(
    'timetable_entries',
    { teacher_initial: teacher.initial },
    { sort: { day: 1, start_time: 1 } },
  );
}

async function eventBodyForEntry(entry, audience) {
  const course = await findOne('courses', { code: entry.course_code });
  const title = course
    ? `${course.code} · ${course.title}`
    : entry.course_code || 'Class';

  const parts = [];
  if (audience === 'student') {
    const teacher = await findOne('teachers', { initial: entry.teacher_initial });
    parts.push(
      teacher
        ? `Teacher: ${teacher.name} (${teacher.initial})`
        : `Teacher: ${entry.teacher_initial}`,
    );
  } else {
    const batch = await findOne('batches', { id: entry.batch_id });
    parts.push(
      batch
        ? `Batch: ${batch.name}${batch.session ? ` · ${batch.session}` : ''}`
        : `Batch: ${entry.batch_id}`,
    );
  }
  if (entry.group_name) parts.push(`Group: ${entry.group_name}`);
  parts.push(`Type: ${entry.type || '—'} · Mode: ${entry.mode || '—'}`);

  let location = 'TBA';
  if (entry.mode === 'Online') location = 'Online';
  else if (entry.room_id) {
    const room = await findOne('rooms', {
      $or: [{ id: entry.room_id }, { name: entry.room_id }],
    });
    location = room?.name || entry.room_id;
  }

  const when = nextOccurrenceOfDay(entry.day);
  const tz = await timezone();
  const byDay = RRULE_BYDAY[entry.day] || 'MO';

  return {
    summary: title,
    description: parts.join('\n'),
    location,
    start: {
      dateTime: localDateTimeIso(when, entry.start_time),
      timeZone: tz,
    },
    end: {
      dateTime: localDateTimeIso(when, entry.end_time),
      timeZone: tz,
    },
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${byDay}`],
    extendedProperties: {
      private: {
        smartroutineEntryId: String(entry.id),
      },
    },
  };
}

async function upsertGoogleEvent(userId, timetableEntryId, googleEventId) {
  const id = randomUUID();
  await updateOne(
    'google_calendar_events',
    { user_id: userId, timetable_entry_id: timetableEntryId },
    {
      $set: { google_event_id: googleEventId },
      $setOnInsert: {
        id,
        _id: id,
        user_id: userId,
        timetable_entry_id: timetableEntryId,
      },
    },
    { upsert: true },
  );
}

export async function handleOAuthCallback(code, stateToken) {
  const state = verifyOAuthState(stateToken);
  if (!state) {
    const err = new Error('Invalid or expired Google connect state');
    err.status = 400;
    throw err;
  }

  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  let email = null;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    email = me.data.email || null;
  } catch {
    /* optional */
  }

  const role =
    state.role === 'student'
      ? 'student'
      : state.role === 'teacher_admin'
        ? 'teacher_admin'
        : 'teacher';

  await saveLinkTokens(state.userId, role, tokens, email);

  // Initial sync (best-effort)
  try {
    await syncUserRoutine(state.userId);
  } catch (e) {
    console.warn('Google initial sync failed:', e?.message || e);
  }

  return { userId: state.userId, role: state.role };
}

export async function getLinkStatus(userId) {
  const link = await findOne('google_calendar_links', { user_id: userId });
  return {
    configured: isGoogleCalendarConfigured(),
    connected: Boolean(link),
    email: link?.email || null,
    calendarId: link?.calendar_id || null,
    lastSyncAt: link?.last_sync_at || null,
    lastSyncError: link?.last_sync_error || null,
  };
}

export async function syncUserRoutine(userId) {
  if (!isGoogleCalendarConfigured()) return { ok: false, reason: 'not_configured' };

  const { client, link } = await oauthClientForUser(userId);
  const calendar = google.calendar({ version: 'v3', auth: client });
  const calendarId = await ensureRoutineCalendar(calendar, userId, link);
  const audience = link.user_role === 'student' ? 'student' : 'teacher';

  const entries = await entriesForUser(link);
  const active = entries.filter(
    (e) => !Boolean(e.is_cancelled) && e.day && e.start_time && e.end_time,
  );
  const activeIds = new Set(active.map((e) => e.id));
  const mapped = await findMany('google_calendar_events', { user_id: userId });
  const mapByEntry = new Map(mapped.map((m) => [m.timetable_entry_id, m.google_event_id]));

  for (const entry of active) {
    const body = await eventBodyForEntry(entry, audience);
    const existingId = mapByEntry.get(entry.id);
    try {
      if (existingId) {
        await calendar.events.patch({
          calendarId,
          eventId: existingId,
          requestBody: body,
        });
      } else {
        const created = await calendar.events.insert({
          calendarId,
          requestBody: body,
        });
        const googleEventId = created.data.id;
        await upsertGoogleEvent(userId, entry.id, googleEventId);
        mapByEntry.set(entry.id, googleEventId);
      }
    } catch (e) {
      // Stale event id — recreate
      if (existingId && (e?.code === 404 || e?.status === 404)) {
        await deleteMany('google_calendar_events', {
          user_id: userId,
          timetable_entry_id: entry.id,
        });
        const created = await calendar.events.insert({
          calendarId,
          requestBody: body,
        });
        await upsertGoogleEvent(userId, entry.id, created.data.id);
      } else {
        throw e;
      }
    }
  }

  for (const row of mapped) {
    if (activeIds.has(row.timetable_entry_id)) continue;
    try {
      await calendar.events.delete({
        calendarId,
        eventId: row.google_event_id,
      });
    } catch (e) {
      if (e?.code !== 404 && e?.status !== 404) {
        console.warn('Google event delete failed:', e?.message || e);
      }
    }
    await deleteMany('google_calendar_events', {
      user_id: userId,
      timetable_entry_id: row.timetable_entry_id,
    });
  }

  await updateOne(
    'google_calendar_links',
    { user_id: userId },
    {
      $set: {
        last_sync_at: nowIso(),
        last_sync_error: null,
        updated_at: nowIso(),
      },
    },
  );

  return { ok: true, events: active.length };
}

export async function disconnectGoogle(userId) {
  const link = await findOne('google_calendar_links', { user_id: userId });
  if (!link) return { ok: true };

  if (isGoogleCalendarConfigured() && link.refresh_token) {
    try {
      const client = createOAuthClient();
      await client.revokeToken(link.refresh_token);
    } catch {
      /* best-effort */
    }
  }

  await deleteMany('google_calendar_events', { user_id: userId });
  await deleteMany('google_calendar_links', { user_id: userId });
  return { ok: true };
}

async function linkedUserIdsForEntry(entry) {
  const ids = new Set();
  if (entry?.batch_id) {
    const students = await findMany('students', { batch_id: entry.batch_id });
    const studentIds = students.map((s) => s.id);
    if (studentIds.length) {
      const links = await findMany('google_calendar_links', {
        user_id: { $in: studentIds },
      });
      for (const link of links) ids.add(link.user_id);
    }
  }
  if (entry?.teacher_initial) {
    const teacher = await findOne('teachers', { initial: entry.teacher_initial });
    if (teacher) {
      const link = await findOne('google_calendar_links', { user_id: teacher.id });
      if (link) ids.add(teacher.id);
    }
  }
  return [...ids];
}

/** Fire-and-forget sync for everyone linked who should see this class change. */
export async function queueSyncForEntry(entry) {
  if (!isGoogleCalendarConfigured() || !entry) return;
  const userIds = await linkedUserIdsForEntry(entry);
  if (!userIds.length) return;

  void Promise.all(
    userIds.map(async (userId) => {
      try {
        await syncUserRoutine(userId);
      } catch (e) {
        console.warn(`Google sync failed for ${userId}:`, e?.message || e);
        await updateOne(
          'google_calendar_links',
          { user_id: userId },
          {
            $set: {
              last_sync_error: bind(String(e?.message || e).slice(0, 500)),
              updated_at: nowIso(),
            },
          },
        );
      }
    }),
  );
}
