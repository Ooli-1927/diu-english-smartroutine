import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { all, bind, get, run } from './db.js';

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

function timezone() {
  return get('SELECT timezone FROM app_metadata LIMIT 1')?.timezone || 'Asia/Dhaka';
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

function saveLinkTokens(userId, userRole, tokens, email) {
  const existing = get('SELECT user_id FROM google_calendar_links WHERE user_id = ?', [userId]);
  const expiry = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : null;
  const refresh = tokens.refresh_token;
  if (existing) {
    run(
      `UPDATE google_calendar_links
       SET user_role = ?,
           refresh_token = COALESCE(?, refresh_token),
           access_token = ?,
           expiry = ?,
           email = COALESCE(?, email),
           last_sync_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [
        bind(userRole),
        bind(refresh || null),
        bind(tokens.access_token || null),
        bind(expiry),
        bind(email || null),
        userId,
      ],
    );
  } else {
    if (!refresh) {
      const err = new Error(
        'Google did not return a refresh token. Disconnect the app in Google Account permissions and try Connect again.',
      );
      err.status = 400;
      throw err;
    }
    run(
      `INSERT INTO google_calendar_links
         (user_id, user_role, refresh_token, access_token, expiry, email)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        bind(userRole),
        bind(refresh),
        bind(tokens.access_token || null),
        bind(expiry),
        bind(email || null),
      ],
    );
  }
}

async function oauthClientForUser(userId) {
  const link = get('SELECT * FROM google_calendar_links WHERE user_id = ?', [userId]);
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
    try {
      saveLinkTokens(userId, link.user_role, {
        ...tokens,
        refresh_token: tokens.refresh_token || link.refresh_token,
      }, link.email);
    } catch (e) {
      console.warn('Google token refresh save failed:', e?.message || e);
    }
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
        timeZone: timezone(),
      },
    });
    calendarId = created.data.id;
  }

  run(
    `UPDATE google_calendar_links
     SET calendar_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [bind(calendarId), userId],
  );
  return calendarId;
}

function entriesForUser(link) {
  if (link.user_role === 'student') {
    const student = get('SELECT batch_id, section FROM students WHERE id = ?', [link.user_id]);
    if (!student?.batch_id) return [];
    const rows = all(
      `SELECT * FROM timetable_entries WHERE batch_id = ? ORDER BY day, start_time`,
      [student.batch_id],
    );
    if (!student.section) return rows;
    return rows.filter((e) => !e.section || e.section === student.section || e.group_name === student.section);
  }

  const teacher =
    get('SELECT initial FROM teachers WHERE id = ?', [link.user_id]) ||
    get('SELECT initial FROM teachers WHERE initial = ?', [link.user_id]);
  if (!teacher?.initial) return [];
  return all(
    `SELECT * FROM timetable_entries WHERE teacher_initial = ? ORDER BY day, start_time`,
    [teacher.initial],
  );
}

function eventBodyForEntry(entry, audience) {
  const course = get('SELECT code, title FROM courses WHERE code = ?', [entry.course_code]);
  const title = course
    ? `${course.code} · ${course.title}`
    : entry.course_code || 'Class';

  const parts = [];
  if (audience === 'student') {
    const teacher = get(
      'SELECT name, initial FROM teachers WHERE initial = ?',
      [entry.teacher_initial],
    );
    parts.push(
      teacher
        ? `Teacher: ${teacher.name} (${teacher.initial})`
        : `Teacher: ${entry.teacher_initial}`,
    );
  } else {
    const batch = get('SELECT name, session FROM batches WHERE id = ?', [entry.batch_id]);
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
    const room = get('SELECT name FROM rooms WHERE id = ? OR name = ?', [
      entry.room_id,
      entry.room_id,
    ]);
    location = room?.name || entry.room_id;
  }

  const when = nextOccurrenceOfDay(entry.day);
  const tz = timezone();
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

  saveLinkTokens(state.userId, role, tokens, email);

  // Initial sync (best-effort)
  try {
    await syncUserRoutine(state.userId);
  } catch (e) {
    console.warn('Google initial sync failed:', e?.message || e);
  }

  return { userId: state.userId, role: state.role };
}

export function getLinkStatus(userId) {
  const link = get(
    `SELECT email, calendar_id, last_sync_at, last_sync_error, created_at
     FROM google_calendar_links WHERE user_id = ?`,
    [userId],
  );
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

  const entries = entriesForUser(link);
  const active = entries.filter(
    (e) => !Number(e.is_cancelled) && e.day && e.start_time && e.end_time,
  );
  const activeIds = new Set(active.map((e) => e.id));
  const mapped = all(
    'SELECT timetable_entry_id, google_event_id FROM google_calendar_events WHERE user_id = ?',
    [userId],
  );
  const mapByEntry = new Map(mapped.map((m) => [m.timetable_entry_id, m.google_event_id]));

  for (const entry of active) {
    const body = eventBodyForEntry(entry, audience);
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
        run(
          `INSERT INTO google_calendar_events (user_id, timetable_entry_id, google_event_id)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, timetable_entry_id) DO UPDATE SET google_event_id = excluded.google_event_id`,
          [userId, entry.id, googleEventId],
        );
        mapByEntry.set(entry.id, googleEventId);
      }
    } catch (e) {
      // Stale event id — recreate
      if (existingId && (e?.code === 404 || e?.status === 404)) {
        run(
          'DELETE FROM google_calendar_events WHERE user_id = ? AND timetable_entry_id = ?',
          [userId, entry.id],
        );
        const created = await calendar.events.insert({
          calendarId,
          requestBody: body,
        });
        run(
          `INSERT INTO google_calendar_events (user_id, timetable_entry_id, google_event_id)
           VALUES (?, ?, ?)`,
          [userId, entry.id, created.data.id],
        );
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
    run(
      'DELETE FROM google_calendar_events WHERE user_id = ? AND timetable_entry_id = ?',
      [userId, row.timetable_entry_id],
    );
  }

  run(
    `UPDATE google_calendar_links
     SET last_sync_at = CURRENT_TIMESTAMP,
         last_sync_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [userId],
  );

  return { ok: true, events: active.length };
}

export async function disconnectGoogle(userId) {
  const link = get('SELECT * FROM google_calendar_links WHERE user_id = ?', [userId]);
  if (!link) return { ok: true };

  if (isGoogleCalendarConfigured() && link.refresh_token) {
    try {
      const client = createOAuthClient();
      await client.revokeToken(link.refresh_token);
    } catch {
      /* best-effort */
    }
  }

  run('DELETE FROM google_calendar_events WHERE user_id = ?', [userId]);
  run('DELETE FROM google_calendar_links WHERE user_id = ?', [userId]);
  return { ok: true };
}

function linkedUserIdsForEntry(entry) {
  const ids = new Set();
  if (entry?.batch_id) {
    const students = all(
      `SELECT s.id FROM students s
       INNER JOIN google_calendar_links g ON g.user_id = s.id
       WHERE s.batch_id = ?`,
      [entry.batch_id],
    );
    for (const s of students) ids.add(s.id);
  }
  if (entry?.teacher_initial) {
    const teacher = get('SELECT id FROM teachers WHERE initial = ?', [entry.teacher_initial]);
    if (teacher) {
      const link = get('SELECT user_id FROM google_calendar_links WHERE user_id = ?', [
        teacher.id,
      ]);
      if (link) ids.add(teacher.id);
    }
  }
  return [...ids];
}

/** Fire-and-forget sync for everyone linked who should see this class change. */
export function queueSyncForEntry(entry) {
  if (!isGoogleCalendarConfigured() || !entry) return;
  const userIds = linkedUserIdsForEntry(entry);
  if (!userIds.length) return;

  void Promise.all(
    userIds.map(async (userId) => {
      try {
        await syncUserRoutine(userId);
      } catch (e) {
        console.warn(`Google sync failed for ${userId}:`, e?.message || e);
        run(
          `UPDATE google_calendar_links
           SET last_sync_error = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?`,
          [bind(String(e?.message || e).slice(0, 500)), userId],
        );
      }
    }),
  );
}
