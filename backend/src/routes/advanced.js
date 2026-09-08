import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { all, bind, get, run, transaction } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { findConflicts, conflictsWith } from '../conflicts.js';
import { entryOut } from '../shape.js';
import { recordAudit, fingerprintConflict } from '../audit.js';
import { DEFAULT_DAYS } from '../scheduler.js';
import { announce } from '../notify.js';

export const advancedRouter = Router();
const adminOnly = requireRole('super_admin');

function nowIso() {
  return new Date().toISOString();
}

function minutesNow(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function todayCode(d = new Date()) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}

/* ── Audit ─────────────────────────────────────────────── */
advancedRouter.get('/audit', adminOnly, (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 80);
  const rows = all(
    `SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  res.json(
    rows.map((r) => ({
      ...r,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
      meta: r.meta_json ? JSON.parse(r.meta_json) : null,
    })),
  );
});

/* ── Semesters / snapshots ─────────────────────────────── */
advancedRouter.get('/semesters', adminOnly, (_req, res) => {
  const semesters = all('SELECT * FROM semesters ORDER BY created_at DESC');
  const snapshots = all(
    `SELECT id, semester_id, label, entry_count, created_by, created_at
     FROM timetable_snapshots ORDER BY created_at DESC LIMIT 50`,
  );
  res.json({ semesters, snapshots });
});

advancedRouter.post('/semesters', adminOnly, (req, res) => {
  const id = randomUUID();
  const label = String(req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'label required' });
  run(
    `INSERT INTO semesters (id, label, academic_year, is_active, notes)
     VALUES (?, ?, ?, 0, ?)`,
    [id, label, bind(req.body?.academic_year || null), bind(req.body?.notes || null)],
  );
  recordAudit({
    session: req.session,
    action: 'semester.create',
    entityType: 'semester',
    entityId: id,
    summary: `Created semester ${label}`,
  });
  res.status(201).json(get('SELECT * FROM semesters WHERE id = ?', [id]));
});

advancedRouter.post('/semesters/:id/snapshot', adminOnly, (req, res) => {
  const sem = get('SELECT * FROM semesters WHERE id = ?', [req.params.id]);
  if (!sem) return res.status(404).json({ error: 'Semester not found' });
  const entries = all('SELECT * FROM timetable_entries');
  const id = randomUUID();
  const label = String(req.body?.label || `${sem.label} snapshot`).trim();
  run(
    `INSERT INTO timetable_snapshots (id, semester_id, label, entry_count, payload_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      sem.id,
      label,
      entries.length,
      JSON.stringify(entries),
      bind(req.session?.username || req.session?.id),
    ],
  );
  recordAudit({
    session: req.session,
    action: 'semester.snapshot',
    entityType: 'snapshot',
    entityId: id,
    summary: `Snapshot "${label}" (${entries.length} classes)`,
  });
  res.status(201).json(get(
    `SELECT id, semester_id, label, entry_count, created_by, created_at FROM timetable_snapshots WHERE id = ?`,
    [id],
  ));
});

advancedRouter.post('/semesters/snapshots/:id/restore', adminOnly, (req, res) => {
  const snap = get('SELECT * FROM timetable_snapshots WHERE id = ?', [req.params.id]);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
  const entries = JSON.parse(snap.payload_json || '[]');
  transaction(() => {
    run('DELETE FROM timetable_entries');
    for (const e of entries) {
      run(
        `INSERT INTO timetable_entries
          (id, day, batch_id, teacher_initial, course_code, type, group_name, room_id, mode,
           start_time, end_time, is_cancelled, cancellation_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id || randomUUID(),
          e.day,
          e.batch_id,
          e.teacher_initial,
          e.course_code,
          e.type,
          bind(e.group_name),
          bind(e.room_id),
          e.mode,
          e.start_time,
          e.end_time,
          bind(e.is_cancelled),
          bind(e.cancellation_reason),
          bind(e.created_at || nowIso()),
          nowIso(),
        ],
      );
    }
  });
  recordAudit({
    session: req.session,
    action: 'semester.restore',
    entityType: 'snapshot',
    entityId: snap.id,
    summary: `Restored snapshot "${snap.label}" (${entries.length} classes)`,
  });
  res.json({ ok: true, restored: entries.length, label: snap.label });
});

advancedRouter.post('/semesters/:id/activate', adminOnly, (req, res) => {
  const sem = get('SELECT * FROM semesters WHERE id = ?', [req.params.id]);
  if (!sem) return res.status(404).json({ error: 'Semester not found' });
  transaction(() => {
    run('UPDATE semesters SET is_active = 0');
    run('UPDATE semesters SET is_active = 1 WHERE id = ?', [sem.id]);
  });
  recordAudit({
    session: req.session,
    action: 'semester.activate',
    entityType: 'semester',
    entityId: sem.id,
    summary: `Activated ${sem.label}`,
  });
  res.json({ ok: true, semester: get('SELECT * FROM semesters WHERE id = ?', [sem.id]) });
});

/* ── What-if simulator ─────────────────────────────────── */
advancedRouter.post('/simulate/what-if', adminOnly, (req, res) => {
  const live = all('SELECT * FROM timetable_entries').map(entryOut);
  const patch = req.body?.patch || {};
  const entryId = patch.entryId || patch.id;
  let simulated = live.map((e) => ({ ...e }));

  if (entryId) {
    simulated = simulated.map((e) => {
      if (e.id !== entryId) return e;
      return {
        ...e,
        ...('day' in patch ? { day: patch.day } : {}),
        ...('start_time' in patch ? { start_time: patch.start_time } : {}),
        ...('end_time' in patch ? { end_time: patch.end_time } : {}),
        ...('room_id' in patch ? { room_id: patch.room_id } : {}),
        ...('is_cancelled' in patch ? { is_cancelled: Boolean(patch.is_cancelled) } : {}),
        ...('teacher_initial' in patch ? { teacher_initial: patch.teacher_initial } : {}),
      };
    });
  }

  if (Array.isArray(req.body?.cancelIds)) {
    const set = new Set(req.body.cancelIds);
    simulated = simulated.map((e) => (set.has(e.id) ? { ...e, is_cancelled: true } : e));
  }

  const before = findConflicts(live);
  const after = findConflicts(simulated);
  const target = entryId ? simulated.find((e) => e.id === entryId) : null;
  const ripple = target
    ? conflictsWith(target, simulated.filter((e) => e.id !== target.id))
    : after;

  const freedRooms = [];
  if (patch.is_cancelled && entryId) {
    const orig = live.find((e) => e.id === entryId);
    if (orig?.room_id) freedRooms.push(orig.room_id);
  }

  res.json({
    beforeCount: before.length,
    afterCount: after.length,
    delta: after.length - before.length,
    ripple,
    afterConflicts: after.slice(0, 40),
    freedRooms,
    suggestion:
      after.length < before.length
        ? 'This change reduces clashes.'
        : after.length > before.length
          ? 'This change introduces new clashes — review ripple list.'
          : 'Clash count unchanged.',
  });
});

/* ── Live occupancy ────────────────────────────────────── */
advancedRouter.get('/rooms/occupancy/live', requireAuth, (_req, res) => {
  const day = todayCode();
  const now = minutesNow();
  const rooms = all('SELECT * FROM rooms ORDER BY name');
  const presence = Object.fromEntries(
    all('SELECT * FROM room_presence').map((p) => [p.room_id, p]),
  );
  const liveClasses = all(
    `SELECT * FROM timetable_entries
     WHERE day = ? AND is_cancelled = 0 AND mode != 'Online'`,
    [day],
  ).filter((e) => toMin(e.start_time) <= now && now < toMin(e.end_time));

  const byRoom = Object.fromEntries(liveClasses.map((e) => [e.room_id, e]));
  res.json({
    day,
    now: new Date().toISOString(),
    rooms: rooms.map((r) => {
      const scheduled = byRoom[r.id] || null;
      const live = presence[r.id] || null;
      let status = 'free';
      if (scheduled) status = 'busy';
      if (live?.status === 'full') status = 'full';
      if (live?.status === 'busy' && !scheduled) status = 'busy';
      if (live?.status === 'free' && !scheduled) status = 'free';
      return {
        ...r,
        status,
        scheduled: scheduled
          ? {
              id: scheduled.id,
              course_code: scheduled.course_code,
              teacher_initial: scheduled.teacher_initial,
              start_time: scheduled.start_time,
              end_time: scheduled.end_time,
              batch_id: scheduled.batch_id,
            }
          : null,
        presence: live,
      };
    }),
  });
});

advancedRouter.put('/rooms/:id/presence', adminOnly, (req, res) => {
  const room = get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const status = String(req.body?.status || 'unknown');
  if (!['free', 'busy', 'full', 'unknown'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  run(
    `INSERT INTO room_presence (room_id, status, note, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET
       status = excluded.status,
       note = excluded.note,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    [
      room.id,
      status,
      bind(req.body?.note || null),
      bind(req.session?.username || req.session?.id),
      nowIso(),
    ],
  );
  res.json(get('SELECT * FROM room_presence WHERE room_id = ?', [room.id]));
});

/* ── Negotiations ──────────────────────────────────────── */
advancedRouter.get('/negotiations', requireAuth, (req, res) => {
  const rows = all(
    `SELECT * FROM conflict_negotiations ORDER BY created_at DESC LIMIT 100`,
  );
  const role = req.session?.role;
  const filtered =
    role === 'super_admin'
      ? rows
      : rows.filter((n) => {
          const prop = n.proposal_json ? JSON.parse(n.proposal_json) : {};
          return (
            prop.targetTeacher === req.session?.teacherInitial ||
            n.initiator_id === req.session?.teacherInitial ||
            n.initiator_id === req.session?.id
          );
        });
  res.json(
    filtered.map((n) => ({
      ...n,
      proposal: n.proposal_json ? JSON.parse(n.proposal_json) : null,
    })),
  );
});

advancedRouter.post('/negotiations', requireAuth, (req, res) => {
  const { kind, resource, message, entryAId, entryBId, proposal } = req.body || {};
  if (!entryAId || !entryBId) {
    return res.status(400).json({ error: 'entryAId and entryBId required' });
  }
  const a = get('SELECT * FROM timetable_entries WHERE id = ?', [entryAId]);
  const b = get('SELECT * FROM timetable_entries WHERE id = ?', [entryBId]);
  if (!a || !b) return res.status(404).json({ error: 'Entries not found' });
  const fp = fingerprintConflict({
    kind: kind || 'teacher',
    resource: resource || a.teacher_initial,
    day: a.day,
    start_time: a.start_time,
    message: message || '',
  });
  const id = randomUUID();
  run(
    `INSERT INTO conflict_negotiations
      (id, fingerprint, status, kind, resource, message, entry_a_id, entry_b_id,
       initiator_role, initiator_id, proposal_json)
     VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fp,
      bind(kind || 'teacher'),
      bind(resource || a.teacher_initial),
      bind(message || `Resolve clash between ${a.course_code} and ${b.course_code}`),
      entryAId,
      entryBId,
      bind(req.session?.role),
      bind(req.session?.teacherInitial || req.session?.id),
      JSON.stringify(
        proposal || {
          moveEntryId: entryBId,
          suggestedDay: a.day,
          targetTeacher: b.teacher_initial,
        },
      ),
    ],
  );
  recordAudit({
    session: req.session,
    action: 'negotiation.create',
    entityType: 'negotiation',
    entityId: id,
    summary: message || 'Conflict negotiation opened',
  });
  res.status(201).json(get('SELECT * FROM conflict_negotiations WHERE id = ?', [id]));
});

advancedRouter.post('/negotiations/:id/respond', requireAuth, (req, res) => {
  const n = get('SELECT * FROM conflict_negotiations WHERE id = ?', [req.params.id]);
  if (!n) return res.status(404).json({ error: 'Not found' });
  if (n.status !== 'open') return res.status(400).json({ error: 'Already resolved' });
  const accept = Boolean(req.body?.accept);
  const proposal = n.proposal_json ? JSON.parse(n.proposal_json) : {};

  if (accept && proposal.moveEntryId && (proposal.day || proposal.start_time || proposal.room_id)) {
    const entry = get('SELECT * FROM timetable_entries WHERE id = ?', [proposal.moveEntryId]);
    if (entry) {
      const next = {
        ...entry,
        day: proposal.day || entry.day,
        start_time: proposal.start_time || entry.start_time,
        end_time: proposal.end_time || entry.end_time,
        room_id: proposal.room_id !== undefined ? proposal.room_id : entry.room_id,
      };
      const clashes = conflictsWith(
        next,
        all('SELECT * FROM timetable_entries').filter((e) => e.id !== entry.id),
      );
      if (clashes.length && !req.body?.force) {
        return res.status(409).json({ error: 'Proposal still clashes', conflicts: clashes });
      }
      run(
        `UPDATE timetable_entries
         SET day = ?, start_time = ?, end_time = ?, room_id = ?, updated_at = ?
         WHERE id = ?`,
        [
          next.day,
          next.start_time,
          next.end_time,
          bind(next.room_id),
          nowIso(),
          entry.id,
        ],
      );
      try {
        announce(entryOut(next), 'class_reschedule', 'Class rescheduled', 'Negotiation accepted.');
      } catch {
        /* ignore notify errors */
      }
    }
  }

  run(
    `UPDATE conflict_negotiations SET status = ?, resolved_at = ? WHERE id = ?`,
    [accept ? 'accepted' : 'rejected', nowIso(), n.id],
  );
  recordAudit({
    session: req.session,
    action: accept ? 'negotiation.accept' : 'negotiation.reject',
    entityType: 'negotiation',
    entityId: n.id,
    summary: accept ? 'Negotiation accepted' : 'Negotiation rejected',
  });
  res.json(get('SELECT * FROM conflict_negotiations WHERE id = ?', [n.id]));
});

/* ── Attendance QR ─────────────────────────────────────── */
advancedRouter.post('/attendance/open', requireAuth, (req, res) => {
  const entryId = String(req.body?.entryId || '');
  const entry = get('SELECT * FROM timetable_entries WHERE id = ?', [entryId]);
  if (!entry) return res.status(404).json({ error: 'Class not found' });
  const role = req.session?.role;
  if (
    role !== 'super_admin' &&
    req.session?.teacherInitial &&
    req.session.teacherInitial !== entry.teacher_initial
  ) {
    return res.status(403).json({ error: 'Not your class' });
  }
  const token = randomBytes(12).toString('hex');
  const id = randomUUID();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  run(
    `UPDATE attendance_sessions SET is_open = 0 WHERE entry_id = ? AND is_open = 1`,
    [entryId],
  );
  run(
    `INSERT INTO attendance_sessions (id, entry_id, token, opened_by, expires_at, is_open)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [
      id,
      entryId,
      token,
      bind(req.session?.teacherInitial || req.session?.username || req.session?.id),
      expires,
    ],
  );
  res.status(201).json({
    id,
    token,
    expires_at: expires,
    entry: entryOut(entry),
    scanUrl: `/student/attendance?token=${token}`,
  });
});

advancedRouter.post('/attendance/scan', requireAuth, (req, res) => {
  if (req.session?.role !== 'student') {
    return res.status(403).json({ error: 'Students only' });
  }
  const token = String(req.body?.token || '').trim();
  const session = get(
    `SELECT * FROM attendance_sessions WHERE token = ? AND is_open = 1`,
    [token],
  );
  if (!session) return res.status(404).json({ error: 'Invalid or closed session' });
  if (new Date(session.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Session expired' });
  }
  const studentId = req.session.studentId || req.session.id;
  const student = get(
    `SELECT * FROM students WHERE student_id = ? OR id = ?`,
    [studentId, studentId],
  );
  try {
    run(
      `INSERT INTO attendance_records (id, session_id, student_id, student_name)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), session.id, student?.student_id || studentId, bind(student?.name || null)],
    );
  } catch {
    return res.status(409).json({ error: 'Already marked present' });
  }
  res.json({ ok: true, course: get('SELECT course_code FROM timetable_entries WHERE id = ?', [session.entry_id]) });
});

advancedRouter.get('/attendance/report', adminOnly, (req, res) => {
  const entryId = req.query.entryId;
  let sessions;
  if (entryId) {
    sessions = all(`SELECT * FROM attendance_sessions WHERE entry_id = ? ORDER BY created_at DESC`, [
      String(entryId),
    ]);
  } else {
    sessions = all(`SELECT * FROM attendance_sessions ORDER BY created_at DESC LIMIT 40`);
  }
  res.json(
    sessions.map((s) => ({
      ...s,
      records: all(`SELECT * FROM attendance_records WHERE session_id = ? ORDER BY scanned_at`, [s.id]),
    })),
  );
});

/* ── Predictive load ───────────────────────────────────── */
advancedRouter.get('/analytics/predictive', adminOnly, (_req, res) => {
  const entries = all('SELECT * FROM timetable_entries WHERE is_cancelled = 0');
  const teacherLoad = {};
  const dayHour = {};
  for (const e of entries) {
    teacherLoad[e.teacher_initial] = (teacherLoad[e.teacher_initial] || 0) + 1;
    const h = Number(String(e.start_time).slice(0, 2));
    const key = `${e.day}|${h}`;
    dayHour[key] = (dayHour[key] || 0) + 1;
  }
  const burnout = Object.entries(teacherLoad)
    .map(([teacher, load]) => ({
      teacher,
      load,
      risk: load >= 12 ? 'high' : load >= 8 ? 'medium' : 'low',
      advice:
        load >= 12
          ? 'Redistribute 1–2 sessions to another day or co-teacher.'
          : load >= 8
            ? 'Watch consecutive slots; avoid adding Friday load.'
            : 'Load looks healthy.',
    }))
    .sort((a, b) => b.load - a.load);

  const hotSlots = Object.entries(dayHour)
    .map(([k, count]) => {
      const [day, hour] = k.split('|');
      return { day, hour: Number(hour), count, pressure: count >= 6 ? 'peak' : count >= 4 ? 'busy' : 'ok' };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const forecast = burnout.slice(0, 5).map((b) => ({
    teacher: b.teacher,
    nextWeekLoad: Math.round(b.load * 1.05),
    trend: b.load >= 10 ? 'rising' : 'stable',
  }));

  res.json({ burnout, hotSlots, forecast, generatedAt: nowIso() });
});

/* ── Student optimizer ─────────────────────────────────── */
advancedRouter.get('/students/me/preferences', requireAuth, (req, res) => {
  if (req.session?.role !== 'student') return res.status(403).json({ error: 'Students only' });
  const sid = req.session.studentId || req.session.id;
  const row = get('SELECT * FROM student_preferences WHERE student_id = ?', [sid]);
  res.json(
    row || {
      student_id: sid,
      avoid_early: 0,
      prefer_gaps: 1,
      max_daily: 4,
      prefer_online: 0,
      notes: null,
    },
  );
});

advancedRouter.put('/students/me/preferences', requireAuth, (req, res) => {
  if (req.session?.role !== 'student') return res.status(403).json({ error: 'Students only' });
  const sid = req.session.studentId || req.session.id;
  run(
    `INSERT INTO student_preferences (student_id, avoid_early, prefer_gaps, max_daily, prefer_online, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(student_id) DO UPDATE SET
       avoid_early = excluded.avoid_early,
       prefer_gaps = excluded.prefer_gaps,
       max_daily = excluded.max_daily,
       prefer_online = excluded.prefer_online,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    [
      sid,
      bind(Boolean(req.body?.avoid_early)),
      bind(req.body?.prefer_gaps !== false),
      Number(req.body?.max_daily) || 4,
      bind(Boolean(req.body?.prefer_online)),
      bind(req.body?.notes || null),
      nowIso(),
    ],
  );
  res.json(get('SELECT * FROM student_preferences WHERE student_id = ?', [sid]));
});

advancedRouter.post('/students/me/optimize', requireAuth, (req, res) => {
  if (req.session?.role !== 'student') return res.status(403).json({ error: 'Students only' });
  const sid = req.session.studentId || req.session.id;
  const student = get(`SELECT * FROM students WHERE student_id = ? OR id = ?`, [sid, sid]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const prefs =
    get('SELECT * FROM student_preferences WHERE student_id = ?', [sid]) || {
      avoid_early: 0,
      prefer_gaps: 1,
      max_daily: 4,
    };
  const classes = all(
    `SELECT * FROM timetable_entries WHERE batch_id = ? AND is_cancelled = 0 ORDER BY day, start_time`,
    [student.batch_id],
  ).map(entryOut);

  const byDay = {};
  for (const e of classes) {
    byDay[e.day] = byDay[e.day] || [];
    byDay[e.day].push(e);
  }

  const tips = [];
  const studyBlocks = [];
  for (const day of DEFAULT_DAYS) {
    const list = byDay[day] || [];
    if (prefs.avoid_early && list.some((e) => toMin(e.start_time) < 10 * 60)) {
      tips.push({
        day,
        kind: 'early',
        text: `${day}: early class at ${list[0]?.start_time} — plan commute buffer.`,
      });
    }
    if (list.length > (prefs.max_daily || 4)) {
      tips.push({
        day,
        kind: 'overload',
        text: `${day}: ${list.length} classes exceeds your max (${prefs.max_daily}).`,
      });
    }
    for (let i = 0; i < list.length - 1; i += 1) {
      const gap = toMin(list[i + 1].start_time) - toMin(list[i].end_time);
      if (gap >= 60) {
        studyBlocks.push({
          day,
          start_time: list[i].end_time,
          end_time: list[i + 1].start_time,
          minutes: gap,
          suggestion: prefs.prefer_gaps
            ? 'Use this gap for focused study / library.'
            : 'Optional free window.',
        });
      }
    }
    if (!list.length) {
      studyBlocks.push({
        day,
        start_time: '09:00',
        end_time: '12:00',
        minutes: 180,
        suggestion: 'Free day morning — deep work block.',
      });
    }
  }

  const score = Math.max(
    0,
    100 -
      tips.filter((t) => t.kind === 'overload').length * 15 -
      (prefs.avoid_early ? tips.filter((t) => t.kind === 'early').length * 8 : 0),
  );

  res.json({
    score,
    tips,
    studyBlocks: studyBlocks.slice(0, 14),
    classCount: classes.length,
    prefs,
  });
});

/* ── NL ops ────────────────────────────────────────────── */
function parseNl(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();
  if (!t) return { intent: 'empty', plan: null };

  const cancel = lower.match(/cancel\s+(\w+)\s+(sat|sun|mon|tue|wed|thu|fri)\s+([a-z]{2,}\s*\d+)/i);
  if (cancel || /cancel/.test(lower)) {
    const day = (t.match(/\b(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\b/i) || [])[1];
    const course = (t.match(/\b([A-Z]{2,}\s?\d{2,3})\b/i) || [])[1];
    const teacher = (t.match(/\bfor\s+([A-Z]{1,4})\b/) || t.match(/\b([A-Z]{2,4})\b.*cancel/i) || [])[1];
    return {
      intent: 'cancel_class',
      plan: {
        action: 'cancel',
        day: day || null,
        course_code: course ? course.replace(/\s+/g, ' ').toUpperCase() : null,
        teacher_initial: teacher || null,
        dryRun: true,
      },
      confidence: course && day ? 0.85 : 0.45,
    };
  }

  if (/free\s+room|rooms?\s+free|empty\s+room/i.test(lower)) {
    const day = (t.match(/\b(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\b/i) || [])[1] || todayCode();
    const time = (t.match(/\b(\d{1,2}:\d{2})\b/) || [])[1] || '10:15';
    return {
      intent: 'free_rooms',
      plan: { action: 'free_rooms', day, time },
      confidence: 0.8,
    };
  }

  if (/what.?if|simulate|move\s+/i.test(lower)) {
    const day = (t.match(/\b(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\b/i) || [])[1];
    const course = (t.match(/\b([A-Z]{2,}\s?\d{2,3})\b/i) || [])[1];
    return {
      intent: 'what_if_move',
      plan: {
        action: 'what_if',
        course_code: course ? course.replace(/\s+/g, ' ').toUpperCase() : null,
        day: day || null,
      },
      confidence: 0.55,
    };
  }

  if (/conflict|clash/i.test(lower)) {
    return { intent: 'list_conflicts', plan: { action: 'conflicts' }, confidence: 0.9 };
  }

  if (/snapshot|backup\s+routine/i.test(lower)) {
    return {
      intent: 'snapshot',
      plan: { action: 'snapshot', label: 'NL snapshot' },
      confidence: 0.75,
    };
  }

  return {
    intent: 'unknown',
    plan: null,
    confidence: 0.1,
    hint: 'Try: "cancel CSE 113 on Thu", "free rooms Sat 10:15", "list conflicts", "snapshot routine"',
  };
}

advancedRouter.post('/ops/nl', adminOnly, (req, res) => {
  const text = String(req.body?.text || '');
  const parsed = parseNl(text);
  const execute = Boolean(req.body?.execute);
  let result = null;

  if (parsed.plan?.action === 'conflicts') {
    result = { conflicts: findConflicts(all('SELECT * FROM timetable_entries')).slice(0, 30) };
  } else if (parsed.plan?.action === 'free_rooms') {
    const day = parsed.plan.day;
    const time = parsed.plan.time;
    const busy = new Set(
      all(
        `SELECT room_id FROM timetable_entries
         WHERE day = ? AND is_cancelled = 0 AND room_id IS NOT NULL
           AND start_time <= ? AND end_time > ?`,
        [day, time, time],
      ).map((r) => r.room_id),
    );
    result = {
      day,
      time,
      free: all('SELECT * FROM rooms').filter((r) => !busy.has(r.id)),
    };
  } else if (parsed.plan?.action === 'cancel' && parsed.plan.course_code) {
    const matches = all(
      `SELECT * FROM timetable_entries
       WHERE course_code = ? AND is_cancelled = 0
         ${parsed.plan.day ? 'AND day = ?' : ''}`,
      parsed.plan.day
        ? [parsed.plan.course_code, parsed.plan.day]
        : [parsed.plan.course_code],
    );
    result = { matches: matches.map(entryOut), wouldCancel: matches.length };
    if (execute && matches.length) {
      for (const e of matches) {
        run(
          `UPDATE timetable_entries SET is_cancelled = 1, cancellation_reason = ?, updated_at = ? WHERE id = ?`,
          ['Cancelled via NL ops', nowIso(), e.id],
        );
      }
      result.executed = true;
    }
  } else if (parsed.plan?.action === 'snapshot' && execute) {
    let sem = get('SELECT * FROM semesters WHERE is_active = 1');
    if (!sem) {
      const id = randomUUID();
      run(`INSERT INTO semesters (id, label, is_active) VALUES (?, 'Live', 1)`, [id]);
      sem = get('SELECT * FROM semesters WHERE id = ?', [id]);
    }
    const entries = all('SELECT * FROM timetable_entries');
    const id = randomUUID();
    run(
      `INSERT INTO timetable_snapshots (id, semester_id, label, entry_count, payload_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, sem.id, 'NL snapshot', entries.length, JSON.stringify(entries), bind(req.session?.username)],
    );
    result = { snapshotId: id, entries: entries.length };
  } else if (parsed.plan?.action === 'what_if' && parsed.plan.course_code) {
    const hit = get(
      `SELECT * FROM timetable_entries WHERE course_code = ? AND is_cancelled = 0 LIMIT 1`,
      [parsed.plan.course_code],
    );
    if (hit) {
      const live = all('SELECT * FROM timetable_entries');
      const sim = live.map((e) =>
        e.id === hit.id
          ? { ...e, day: parsed.plan.day || e.day, is_cancelled: parsed.plan.day ? 0 : 1 }
          : e,
      );
      result = {
        target: entryOut(hit),
        before: findConflicts(live).length,
        after: findConflicts(sim).length,
      };
    } else result = { error: 'No matching class' };
  }

  const id = randomUUID();
  run(
    `INSERT INTO nl_command_log (id, actor_id, text, intent, plan_json, executed)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      bind(req.session?.id || req.session?.username),
      text,
      parsed.intent,
      JSON.stringify(parsed.plan),
      bind(execute && result && !result.error),
    ],
  );
  recordAudit({
    session: req.session,
    action: 'nl.ops',
    entityType: 'nl',
    entityId: id,
    summary: `NL: ${parsed.intent}`,
    meta: { text, execute },
  });

  res.json({ ...parsed, result, logId: id });
});

/* Seed soft constraints echo for generate clients */
advancedRouter.get('/advanced/capabilities', requireAuth, (_req, res) => {
  res.json({
    features: [
      'audit',
      'semesters',
      'what-if',
      'occupancy',
      'negotiations',
      'attendance-qr',
      'predictive',
      'student-optimizer',
      'nl-ops',
      'soft-constraints',
    ],
  });
});
