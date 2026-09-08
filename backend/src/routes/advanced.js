import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  bind,
  deleteMany,
  findMany,
  findOne,
  insertOne,
  nowIso,
  transaction,
  updateMany,
  updateOne,
} from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { findConflicts, conflictsWith } from '../conflicts.js';
import { entryOut } from '../shape.js';
import { recordAudit, fingerprintConflict } from '../audit.js';
import { DEFAULT_DAYS } from '../scheduler.js';
import { announce } from '../notify.js';

export const advancedRouter = Router();
const adminOnly = requireRole('super_admin');

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

function parseJsonField(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/* ── Audit ─────────────────────────────────────────────── */
advancedRouter.get('/audit', adminOnly, async (req, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 80);
    const rows = await findMany(
      'audit_events',
      {},
      { sort: { created_at: -1 }, limit },
    );
    res.json(
      rows.map((r) => ({
        ...r,
        before: parseJsonField(r.before_json),
        after: parseJsonField(r.after_json),
        meta: parseJsonField(r.meta_json),
      })),
    );
  } catch (e) {
    next(e);
  }
});

/* ── Semesters / snapshots ─────────────────────────────── */
advancedRouter.get('/semesters', adminOnly, async (_req, res, next) => {
  try {
    const semesters = await findMany('semesters', {}, { sort: { created_at: -1 } });
    const snapshots = await findMany(
      'timetable_snapshots',
      {},
      { sort: { created_at: -1 }, limit: 50 },
    );
    res.json({
      semesters,
      snapshots: snapshots.map((s) => ({
        id: s.id,
        semester_id: s.semester_id,
        label: s.label,
        entry_count: s.entry_count,
        created_by: s.created_by,
        created_at: s.created_at,
      })),
    });
  } catch (e) {
    next(e);
  }
});

advancedRouter.post('/semesters', adminOnly, async (req, res, next) => {
  try {
    const id = randomUUID();
    const label = String(req.body?.label || '').trim();
    if (!label) return res.status(400).json({ error: 'label required' });
    await insertOne('semesters', {
      id,
      label,
      academic_year: bind(req.body?.academic_year || null),
      is_active: false,
      notes: bind(req.body?.notes || null),
      created_at: nowIso(),
    });
    await recordAudit({
      session: req.session,
      action: 'semester.create',
      entityType: 'semester',
      entityId: id,
      summary: `Created semester ${label}`,
    });
    res.status(201).json(await findOne('semesters', { id }));
  } catch (e) {
    next(e);
  }
});

advancedRouter.post('/semesters/:id/snapshot', adminOnly, async (req, res, next) => {
  try {
    const sem = await findOne('semesters', { id: req.params.id });
    if (!sem) return res.status(404).json({ error: 'Semester not found' });
    const entries = await findMany('timetable_entries', {});
    const id = randomUUID();
    const label = String(req.body?.label || `${sem.label} snapshot`).trim();
    await insertOne('timetable_snapshots', {
      id,
      semester_id: sem.id,
      label,
      entry_count: entries.length,
      payload_json: JSON.stringify(entries),
      created_by: bind(req.session?.username || req.session?.id),
      created_at: nowIso(),
    });
    await recordAudit({
      session: req.session,
      action: 'semester.snapshot',
      entityType: 'snapshot',
      entityId: id,
      summary: `Snapshot "${label}" (${entries.length} classes)`,
    });
    res.status(201).json({
      id,
      semester_id: sem.id,
      label,
      entry_count: entries.length,
      created_by: req.session?.username || req.session?.id,
      created_at: (await findOne('timetable_snapshots', { id }))?.created_at,
    });
  } catch (e) {
    next(e);
  }
});

advancedRouter.post('/semesters/snapshots/:id/restore', adminOnly, async (req, res, next) => {
  try {
    const snap = await findOne('timetable_snapshots', { id: req.params.id });
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    const entries = parseJsonField(snap.payload_json) || [];
    await transaction(async () => {
      await deleteMany('timetable_entries', {});
      for (const e of entries) {
        const id = e.id || randomUUID();
        await insertOne('timetable_entries', {
          id,
          day: e.day,
          batch_id: e.batch_id,
          teacher_initial: e.teacher_initial,
          course_code: e.course_code,
          type: e.type,
          section: bind(e.section || e.group_name || null),
          group_name: bind(e.group_name),
          room_id: bind(e.room_id),
          mode: e.mode,
          start_time: e.start_time,
          end_time: e.end_time,
          is_cancelled: Boolean(e.is_cancelled),
          cancellation_reason: bind(e.cancellation_reason),
          created_at: bind(e.created_at || nowIso()),
          updated_at: nowIso(),
        });
      }
    });
    await recordAudit({
      session: req.session,
      action: 'semester.restore',
      entityType: 'snapshot',
      entityId: snap.id,
      summary: `Restored snapshot "${snap.label}" (${entries.length} classes)`,
    });
    res.json({ ok: true, restored: entries.length, label: snap.label });
  } catch (e) {
    next(e);
  }
});

advancedRouter.post('/semesters/:id/activate', adminOnly, async (req, res, next) => {
  try {
    const sem = await findOne('semesters', { id: req.params.id });
    if (!sem) return res.status(404).json({ error: 'Semester not found' });
    await transaction(async () => {
      await updateMany('semesters', {}, { $set: { is_active: false } });
      await updateOne('semesters', { id: sem.id }, { $set: { is_active: true } });
    });
    await recordAudit({
      session: req.session,
      action: 'semester.activate',
      entityType: 'semester',
      entityId: sem.id,
      summary: `Activated ${sem.label}`,
    });
    res.json({ ok: true, semester: await findOne('semesters', { id: sem.id }) });
  } catch (e) {
    next(e);
  }
});

/* ── What-if simulator ─────────────────────────────────── */
advancedRouter.post('/simulate/what-if', adminOnly, async (req, res, next) => {
  try {
    const live = (await findMany('timetable_entries', {})).map(entryOut);
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
  } catch (e) {
    next(e);
  }
});

/* ── Live occupancy ────────────────────────────────────── */
advancedRouter.get('/rooms/occupancy/live', requireAuth, async (_req, res, next) => {
  try {
    const day = todayCode();
    const now = minutesNow();
    const rooms = await findMany('rooms', {}, { sort: { name: 1 } });
    const presence = Object.fromEntries(
      (await findMany('room_presence', {})).map((p) => [p.room_id, p]),
    );
    const liveClasses = (await findMany('timetable_entries', {
      day,
      is_cancelled: { $ne: true },
      mode: { $ne: 'Online' },
    })).filter((e) => toMin(e.start_time) <= now && now < toMin(e.end_time));

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
  } catch (e) {
    next(e);
  }
});

advancedRouter.put('/rooms/:id/presence', adminOnly, async (req, res, next) => {
  try {
    const room = await findOne('rooms', { id: req.params.id });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const status = String(req.body?.status || 'unknown');
    if (!['free', 'busy', 'full', 'unknown'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const updatedAt = nowIso();
    await updateOne(
      'room_presence',
      { room_id: room.id },
      {
        $set: {
          room_id: room.id,
          status,
          note: bind(req.body?.note || null),
          updated_by: bind(req.session?.username || req.session?.id),
          updated_at: updatedAt,
        },
        $setOnInsert: {
          id: room.id,
          _id: room.id,
        },
      },
      { upsert: true },
    );
    res.json(await findOne('room_presence', { room_id: room.id }));
  } catch (e) {
    next(e);
  }
});

/* ── Negotiations ──────────────────────────────────────── */
advancedRouter.get('/negotiations', requireAuth, async (req, res, next) => {
  try {
    const rows = await findMany(
      'conflict_negotiations',
      {},
      { sort: { created_at: -1 }, limit: 100 },
    );
    const role = req.session?.role;
    const filtered =
      role === 'super_admin'
        ? rows
        : rows.filter((n) => {
            const prop = parseJsonField(n.proposal_json) || {};
            return (
              prop.targetTeacher === req.session?.teacherInitial ||
              n.initiator_id === req.session?.teacherInitial ||
              n.initiator_id === req.session?.id
            );
          });
    res.json(
      filtered.map((n) => ({
        ...n,
        proposal: parseJsonField(n.proposal_json),
      })),
    );
  } catch (e) {
    next(e);
  }
});

advancedRouter.post('/negotiations', requireAuth, async (req, res, next) => {
  try {
    const { kind, resource, message, entryAId, entryBId, proposal } = req.body || {};
    if (!entryAId || !entryBId) {
      return res.status(400).json({ error: 'entryAId and entryBId required' });
    }
    const a = await findOne('timetable_entries', { id: entryAId });
    const b = await findOne('timetable_entries', { id: entryBId });
    if (!a || !b) return res.status(404).json({ error: 'Entries not found' });
    const fp = fingerprintConflict({
      kind: kind || 'teacher',
      resource: resource || a.teacher_initial,
      day: a.day,
      start_time: a.start_time,
      message: message || '',
    });
    const id = randomUUID();
    await insertOne('conflict_negotiations', {
      id,
      fingerprint: fp,
      status: 'open',
      kind: bind(kind || 'teacher'),
      resource: bind(resource || a.teacher_initial),
      message: bind(message || `Resolve clash between ${a.course_code} and ${b.course_code}`),
      entry_a_id: entryAId,
      entry_b_id: entryBId,
      initiator_role: bind(req.session?.role),
      initiator_id: bind(req.session?.teacherInitial || req.session?.id),
      proposal_json: JSON.stringify(
        proposal || {
          moveEntryId: entryBId,
          suggestedDay: a.day,
          targetTeacher: b.teacher_initial,
        },
      ),
      created_at: nowIso(),
    });
    await recordAudit({
      session: req.session,
      action: 'negotiation.create',
      entityType: 'negotiation',
      entityId: id,
      summary: message || 'Conflict negotiation opened',
    });
    res.status(201).json(await findOne('conflict_negotiations', { id }));
  } catch (e) {
    next(e);
  }
});

advancedRouter.post('/negotiations/:id/respond', requireAuth, async (req, res, next) => {
  try {
    const n = await findOne('conflict_negotiations', { id: req.params.id });
    if (!n) return res.status(404).json({ error: 'Not found' });
    if (n.status !== 'open') return res.status(400).json({ error: 'Already resolved' });
    const accept = Boolean(req.body?.accept);
    const proposal = parseJsonField(n.proposal_json) || {};

    if (accept && proposal.moveEntryId && (proposal.day || proposal.start_time || proposal.room_id)) {
      const entry = await findOne('timetable_entries', { id: proposal.moveEntryId });
      if (entry) {
        const nextEntry = {
          ...entry,
          day: proposal.day || entry.day,
          start_time: proposal.start_time || entry.start_time,
          end_time: proposal.end_time || entry.end_time,
          room_id: proposal.room_id !== undefined ? proposal.room_id : entry.room_id,
        };
        const allEntries = await findMany('timetable_entries', {});
        const clashes = conflictsWith(
          nextEntry,
          allEntries.filter((e) => e.id !== entry.id),
        );
        if (clashes.length && !req.body?.force) {
          return res.status(409).json({ error: 'Proposal still clashes', conflicts: clashes });
        }
        await updateOne(
          'timetable_entries',
          { id: entry.id },
          {
            $set: {
              day: nextEntry.day,
              start_time: nextEntry.start_time,
              end_time: nextEntry.end_time,
              room_id: bind(nextEntry.room_id),
              updated_at: nowIso(),
            },
          },
        );
        try {
          await announce(entryOut(nextEntry), 'class_reschedule', 'Class rescheduled', 'Negotiation accepted.');
        } catch {
          /* ignore notify errors */
        }
      }
    }

    await updateOne(
      'conflict_negotiations',
      { id: n.id },
      { $set: { status: accept ? 'accepted' : 'rejected', resolved_at: nowIso() } },
    );
    await recordAudit({
      session: req.session,
      action: accept ? 'negotiation.accept' : 'negotiation.reject',
      entityType: 'negotiation',
      entityId: n.id,
      summary: accept ? 'Negotiation accepted' : 'Negotiation rejected',
    });
    res.json(await findOne('conflict_negotiations', { id: n.id }));
  } catch (e) {
    next(e);
  }
});

/* ── Attendance QR ─────────────────────────────────────── */
advancedRouter.post('/attendance/open', requireAuth, async (req, res, next) => {
  try {
    const role = req.session?.role;
    if (role !== 'super_admin' && role !== 'teacher' && role !== 'teacher_admin') {
      return res.status(403).json({ error: 'Teachers or chairman only' });
    }
    const entryId = String(req.body?.entryId || '');
    const entry = await findOne('timetable_entries', { id: entryId });
    if (!entry) return res.status(404).json({ error: 'Class not found' });
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
    await updateMany(
      'attendance_sessions',
      { entry_id: entryId, is_open: true },
      { $set: { is_open: false } },
    );
    await insertOne('attendance_sessions', {
      id,
      entry_id: entryId,
      token,
      opened_by: bind(req.session?.teacherInitial || req.session?.username || req.session?.id),
      expires_at: expires,
      is_open: true,
      created_at: nowIso(),
    });
    res.status(201).json({
      id,
      token,
      expires_at: expires,
      entry: entryOut(entry),
      scanUrl: `/student/attendance?token=${token}`,
    });
  } catch (e) {
    next(e);
  }
});

advancedRouter.post('/attendance/scan', requireAuth, async (req, res, next) => {
  try {
    if (req.session?.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }
    const token = String(req.body?.token || '').trim();
    const session = await findOne('attendance_sessions', { token, is_open: true });
    if (!session) return res.status(404).json({ error: 'Invalid or closed session' });
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Session expired' });
    }
    const studentId = req.session.studentId || req.session.id;
    const student = await findOne('students', {
      $or: [{ student_id: studentId }, { id: studentId }],
    });
    try {
      await insertOne('attendance_records', {
        id: randomUUID(),
        session_id: session.id,
        student_id: student?.student_id || studentId,
        student_name: bind(student?.name || null),
        scanned_at: nowIso(),
      });
    } catch (err) {
      const msg = String(err?.message || err);
      if (/duplicate|E11000|unique/i.test(msg)) {
        return res.status(409).json({ error: 'Already marked present' });
      }
      throw err;
    }
    const entry = await findOne('timetable_entries', { id: session.entry_id });
    res.json({ ok: true, course: entry ? { course_code: entry.course_code } : null });
  } catch (e) {
    next(e);
  }
});

advancedRouter.get('/attendance/report', adminOnly, async (req, res, next) => {
  try {
    const entryId = req.query.entryId;
    let sessions;
    if (entryId) {
      sessions = await findMany(
        'attendance_sessions',
        { entry_id: String(entryId) },
        { sort: { created_at: -1 } },
      );
    } else {
      sessions = await findMany(
        'attendance_sessions',
        {},
        { sort: { created_at: -1 }, limit: 40 },
      );
    }
    const out = [];
    for (const s of sessions) {
      out.push({
        ...s,
        records: await findMany(
          'attendance_records',
          { session_id: s.id },
          { sort: { scanned_at: 1 } },
        ),
      });
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

/* ── Predictive load ───────────────────────────────────── */
advancedRouter.get('/analytics/predictive', adminOnly, async (_req, res, next) => {
  try {
    const entries = await findMany('timetable_entries', { is_cancelled: { $ne: true } });
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
  } catch (e) {
    next(e);
  }
});

/* ── Student optimizer ─────────────────────────────────── */
advancedRouter.get('/students/me/preferences', requireAuth, async (req, res, next) => {
  try {
    if (req.session?.role !== 'student') return res.status(403).json({ error: 'Students only' });
    const sid = req.session.studentId || req.session.id;
    const row = await findOne('student_preferences', { student_id: sid });
    res.json(
      row || {
        student_id: sid,
        avoid_early: false,
        prefer_gaps: true,
        max_daily: 4,
        prefer_online: false,
        notes: null,
      },
    );
  } catch (e) {
    next(e);
  }
});

advancedRouter.put('/students/me/preferences', requireAuth, async (req, res, next) => {
  try {
    if (req.session?.role !== 'student') return res.status(403).json({ error: 'Students only' });
    const sid = req.session.studentId || req.session.id;
    const updatedAt = nowIso();
    await updateOne(
      'student_preferences',
      { student_id: sid },
      {
        $set: {
          student_id: sid,
          avoid_early: Boolean(req.body?.avoid_early),
          prefer_gaps: req.body?.prefer_gaps !== false,
          max_daily: Number(req.body?.max_daily) || 4,
          prefer_online: Boolean(req.body?.prefer_online),
          notes: bind(req.body?.notes || null),
          updated_at: updatedAt,
        },
        $setOnInsert: {
          id: sid,
          _id: sid,
        },
      },
      { upsert: true },
    );
    res.json(await findOne('student_preferences', { student_id: sid }));
  } catch (e) {
    next(e);
  }
});

advancedRouter.post('/students/me/optimize', requireAuth, async (req, res, next) => {
  try {
    if (req.session?.role !== 'student') return res.status(403).json({ error: 'Students only' });
    const sid = req.session.studentId || req.session.id;
    const student = await findOne('students', {
      $or: [{ student_id: sid }, { id: sid }],
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const prefs =
      (await findOne('student_preferences', { student_id: sid })) || {
        avoid_early: false,
        prefer_gaps: true,
        max_daily: 4,
      };
    const classes = (
      await findMany(
        'timetable_entries',
        { batch_id: student.batch_id, is_cancelled: { $ne: true } },
        { sort: { day: 1, start_time: 1 } },
      )
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
  } catch (e) {
    next(e);
  }
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

advancedRouter.post('/ops/nl', adminOnly, async (req, res, next) => {
  try {
    const text = String(req.body?.text || '');
    const parsed = parseNl(text);
    const execute = Boolean(req.body?.execute);
    let result = null;

    if (parsed.plan?.action === 'conflicts') {
      result = {
        conflicts: findConflicts(await findMany('timetable_entries', {})).slice(0, 30),
      };
    } else if (parsed.plan?.action === 'free_rooms') {
      const day = parsed.plan.day;
      const time = parsed.plan.time;
      const busyRows = await findMany('timetable_entries', {
        day,
        is_cancelled: { $ne: true },
        room_id: { $nin: [null, ''] },
        start_time: { $lte: time },
        end_time: { $gt: time },
      });
      const busy = new Set(busyRows.map((r) => r.room_id));
      result = {
        day,
        time,
        free: (await findMany('rooms', {})).filter((r) => !busy.has(r.id)),
      };
    } else if (parsed.plan?.action === 'cancel' && parsed.plan.course_code) {
      const filter = {
        course_code: parsed.plan.course_code,
        is_cancelled: { $ne: true },
      };
      if (parsed.plan.day) filter.day = parsed.plan.day;
      const matches = await findMany('timetable_entries', filter);
      result = { matches: matches.map(entryOut), wouldCancel: matches.length };
      if (execute && matches.length) {
        for (const e of matches) {
          await updateOne(
            'timetable_entries',
            { id: e.id },
            {
              $set: {
                is_cancelled: true,
                cancellation_reason: 'Cancelled via NL ops',
                updated_at: nowIso(),
              },
            },
          );
        }
        result.executed = true;
      }
    } else if (parsed.plan?.action === 'snapshot' && execute) {
      let sem = await findOne('semesters', { is_active: true });
      if (!sem) {
        const id = randomUUID();
        await insertOne('semesters', {
          id,
          label: 'Live',
          is_active: true,
          created_at: nowIso(),
        });
        sem = await findOne('semesters', { id });
      }
      const entries = await findMany('timetable_entries', {});
      const id = randomUUID();
      await insertOne('timetable_snapshots', {
        id,
        semester_id: sem.id,
        label: 'NL snapshot',
        entry_count: entries.length,
        payload_json: JSON.stringify(entries),
        created_by: bind(req.session?.username),
        created_at: nowIso(),
      });
      result = { snapshotId: id, entries: entries.length };
    } else if (parsed.plan?.action === 'what_if' && parsed.plan.course_code) {
      const hit = await findOne('timetable_entries', {
        course_code: parsed.plan.course_code,
        is_cancelled: { $ne: true },
      });
      if (hit) {
        const live = await findMany('timetable_entries', {});
        const sim = live.map((e) =>
          e.id === hit.id
            ? { ...e, day: parsed.plan.day || e.day, is_cancelled: parsed.plan.day ? false : true }
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
    await insertOne('nl_command_log', {
      id,
      actor_id: bind(req.session?.id || req.session?.username),
      text,
      intent: parsed.intent,
      plan_json: JSON.stringify(parsed.plan),
      executed: Boolean(execute && result && !result.error),
      created_at: nowIso(),
    });
    await recordAudit({
      session: req.session,
      action: 'nl.ops',
      entityType: 'nl',
      entityId: id,
      summary: `NL: ${parsed.intent}`,
      meta: { text, execute },
    });

    res.json({ ...parsed, result, logId: id });
  } catch (e) {
    next(e);
  }
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
