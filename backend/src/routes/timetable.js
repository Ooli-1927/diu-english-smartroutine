import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  bind,
  deleteMany,
  deleteOne,
  findMany,
  findOne,
  insertOne,
  nowIso,
  transaction,
  updateOne,
} from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { entryOut } from '../shape.js';
import { DEFAULT_DAYS, DEFAULT_SLOTS, generateSchedule } from '../scheduler.js';
import { conflictsWith, findConflicts, summarize } from '../conflicts.js';
import { announce } from '../notify.js';

export const timetableRouter = Router();

const adminOnly = requireRole('super_admin');
const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const TYPES = ['Lecture', 'Tutorial', 'Sessional', 'Online'];
const MODES = ['Onsite', 'Online', 'Offline'];
const TEACHER_EDITABLE = [
  'day',
  'start_time',
  'end_time',
  'room_id',
  'mode',
  'type',
  'is_cancelled',
  'cancellation_reason',
];

async function validateEntry(payload, { partial = false } = {}) {
  const errors = [];
  const need = (key) => !partial || payload[key] !== undefined;

  if (need('day') && !DAYS.includes(payload.day)) errors.push('day must be one of ' + DAYS.join(', '));
  if (need('type') && !TYPES.includes(payload.type)) errors.push('type must be one of ' + TYPES.join(', '));
  if (need('mode') && !MODES.includes(payload.mode)) errors.push('mode must be one of ' + MODES.join(', '));
  if (need('start_time') && !/^\d{2}:\d{2}$/.test(payload.start_time || '')) errors.push('start_time must be HH:MM');
  if (need('end_time') && !/^\d{2}:\d{2}$/.test(payload.end_time || '')) errors.push('end_time must be HH:MM');

  if (!partial) {
    if (!(await findOne('batches', { id: payload.batch_id }))) errors.push('unknown batch_id');
    if (!(await findOne('teachers', { initial: payload.teacher_initial }))) {
      errors.push('unknown teacher_initial');
    }
    if (!(await findOne('courses', { code: payload.course_code }))) errors.push('unknown course_code');
  }
  if (payload.room_id && !(await findOne('rooms', { id: payload.room_id }))) {
    errors.push('unknown room_id');
  }
  return errors;
}

async function conflictReport(entry) {
  const others = (await findMany('timetable_entries', { day: entry.day })).map(entryOut);
  const conflicts = conflictsWith(entryOut(entry), others);
  return conflicts.map((c) => ({
    kind: c.kind,
    resource: c.resource,
    message: c.message,
    with: c.with,
  }));
}

function notCancelledFilter() {
  return { is_cancelled: { $ne: true } };
}

async function distinctSlots() {
  const rows = await findMany('timetable_entries', {}, { sort: { start_time: 1 } });
  const seen = new Map();
  for (const e of rows) {
    const start = String(e.start_time).slice(0, 5);
    const end = String(e.end_time).slice(0, 5);
    const key = `${start}|${end}`;
    if (!seen.has(key)) seen.set(key, { start, end });
  }
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}

timetableRouter.get('/timetable', requireAuth, async (req, res, next) => {
  try {
    const filter = {};
    for (const key of ['day', 'batch_id', 'teacher_initial', 'room_id']) {
      if (req.query[key]) filter[key] = req.query[key];
    }
    const rows = await findMany('timetable_entries', filter, { sort: { start_time: 1 } });
    res.json(rows.map(entryOut));
  } catch (e) {
    next(e);
  }
});

timetableRouter.get('/timetable/free-rooms', requireAuth, async (req, res, next) => {
  try {
    const { day, start, end } = req.query;
    if (!day || !start || !end) {
      return res.status(400).json({ error: 'day, start and end are required' });
    }
    const busyRows = await findMany('timetable_entries', {
      day,
      ...notCancelledFilter(),
      room_id: { $nin: [null, ''] },
      start_time: { $lt: end },
      end_time: { $gt: start },
    });
    const busy = [...new Set(busyRows.map((r) => r.room_id).filter(Boolean))];
    const rooms = await findMany('rooms', {}, { sort: { name: 1 } });
    res.json({
      busy,
      free: rooms.filter((r) => !busy.includes(r.id)),
    });
  } catch (e) {
    next(e);
  }
});

/** Standing audit of the whole routine so clashes cannot hide in the data. */
timetableRouter.get('/timetable/conflicts', adminOnly, async (_req, res, next) => {
  try {
    const entries = (await findMany('timetable_entries', {})).map(entryOut);
    const conflicts = findConflicts(entries);
    res.json({ summary: summarize(conflicts), conflicts });
  } catch (e) {
    next(e);
  }
});

/** The current routine, collapsed into "what needs scheduling" rows. */
timetableRouter.get('/timetable/requirements', adminOnly, async (req, res, next) => {
  try {
    const batchIds = String(req.query.batch_ids || '')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

    const filter = batchIds.length ? { batch_id: { $in: batchIds } } : {};
    const rows = await findMany('timetable_entries', filter);
    const groups = new Map();
    for (const e of rows) {
      const key = [
        e.batch_id,
        e.course_code,
        e.teacher_initial,
        e.type,
        e.mode,
        e.group_name ?? '',
      ].join('\0');
      if (!groups.has(key)) {
        groups.set(key, {
          batch_id: e.batch_id,
          course_code: e.course_code,
          teacher_initial: e.teacher_initial,
          type: e.type,
          mode: e.mode,
          group_name: e.group_name,
          sessions_per_week: 0,
        });
      }
      groups.get(key).sessions_per_week += 1;
    }
    const result = [...groups.values()].sort((a, b) => {
      const bcmp = String(a.batch_id).localeCompare(String(b.batch_id));
      if (bcmp) return bcmp;
      return String(a.course_code).localeCompare(String(b.course_code));
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

timetableRouter.get('/timetable/slots', adminOnly, async (_req, res, next) => {
  try {
    const rows = await distinctSlots();
    res.json({
      days: DEFAULT_DAYS,
      slots: rows.length ? rows : DEFAULT_SLOTS,
    });
  } catch (e) {
    next(e);
  }
});

timetableRouter.post('/timetable/generate', adminOnly, async (req, res, next) => {
  try {
    const {
      requirements,
      days,
      slots,
      replace = false,
      dryRun = true,
      maxPerBatchPerDay = 3,
      maxPerTeacherPerDay = 4,
      soft = {},
    } = req.body || {};

    if (!Array.isArray(requirements) || !requirements.length) {
      return res.status(400).json({ error: 'requirements[] is required' });
    }

    const invalid = [];
    for (let i = 0; i < requirements.length; i += 1) {
      const r = requirements[i];
      if (!(await findOne('batches', { id: r.batch_id }))) {
        invalid.push(`row ${i + 1}: unknown batch_id`);
      }
      if (!(await findOne('teachers', { initial: r.teacher_initial }))) {
        invalid.push(`row ${i + 1}: unknown teacher_initial`);
      }
      if (!(await findOne('courses', { code: r.course_code }))) {
        invalid.push(`row ${i + 1}: unknown course_code`);
      }
      if (r.type && !TYPES.includes(r.type)) invalid.push(`row ${i + 1}: invalid type`);
      if (r.mode && !MODES.includes(r.mode)) invalid.push(`row ${i + 1}: invalid mode`);
    }
    if (invalid.length) return res.status(400).json({ error: invalid.join('; ') });

    const targetBatches = [...new Set(requirements.map((r) => r.batch_id))];
    const allEntries = await findMany('timetable_entries', {});
    // When replacing, the batches being regenerated no longer block their own slots.
    const existing = replace
      ? allEntries.filter((e) => !targetBatches.includes(e.batch_id))
      : allEntries;

    const slotList = Array.isArray(slots) && slots.length ? slots : undefined;
    const dayList = Array.isArray(days) && days.length ? days : undefined;
    const useSlots =
      slotList ||
      (await (async () => {
        const rows = await distinctSlots();
        return rows.length ? rows : DEFAULT_SLOTS;
      })());

    const result = generateSchedule({
      requirements,
      existing,
      rooms: await findMany('rooms', {}, { sort: { name: 1 } }),
      days: dayList || DEFAULT_DAYS,
      slots: useSlots,
      maxPerBatchPerDay: Number(maxPerBatchPerDay) || 3,
      maxPerTeacherPerDay: Number(maxPerTeacherPerDay) || 4,
      soft: soft && typeof soft === 'object' ? soft : {},
    });

    if (dryRun) {
      return res.json({ ...result, applied: false, replaced: Boolean(replace) });
    }

    await transaction(async () => {
      if (replace && targetBatches.length) {
        await deleteMany('timetable_entries', { batch_id: { $in: targetBatches } });
      }
      for (const e of result.scheduled) {
        const section = e.section || e.group_name || null;
        const id = randomUUID();
        await insertOne('timetable_entries', {
          id,
          day: bind(e.day),
          batch_id: bind(e.batch_id),
          teacher_initial: bind(e.teacher_initial),
          course_code: bind(e.course_code),
          type: bind(e.type),
          section: bind(section),
          group_name: bind(e.group_name || section),
          room_id: bind(e.room_id),
          mode: bind(e.mode),
          start_time: bind(e.start_time),
          end_time: bind(e.end_time),
          is_cancelled: false,
          cancellation_reason: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
      }
    });

    const conflicts = findConflicts(
      (await findMany('timetable_entries', {})).map(entryOut),
    );
    res.json({
      ...result,
      applied: true,
      replaced: Boolean(replace),
      conflicts: summarize(conflicts),
    });
  } catch (e) {
    next(e);
  }
});

timetableRouter.post('/timetable', adminOnly, async (req, res, next) => {
  try {
    const payload = req.body || {};
    const errors = await validateEntry(payload);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const clashes = await conflictReport(payload);
    if (clashes.length && !payload.force) {
      return res.status(409).json({
        error: `This class clashes with ${clashes.length} existing ${clashes.length === 1 ? 'class' : 'classes'}`,
        conflicts: clashes,
      });
    }

    const id = payload.id || randomUUID();
    const section =
      payload.section != null && String(payload.section).trim()
        ? String(payload.section).trim().toUpperCase()
        : payload.group_name
          ? String(payload.group_name).trim().toUpperCase()
          : null;
    await insertOne('timetable_entries', {
      id,
      day: bind(payload.day),
      batch_id: bind(payload.batch_id),
      teacher_initial: bind(payload.teacher_initial),
      course_code: bind(payload.course_code),
      type: bind(payload.type),
      section: bind(section),
      group_name: bind(payload.group_name || section),
      room_id: bind(payload.room_id),
      mode: bind(payload.mode),
      start_time: bind(payload.start_time),
      end_time: bind(payload.end_time),
      is_cancelled: Boolean(payload.is_cancelled),
      cancellation_reason: bind(payload.cancellation_reason),
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    const created = await findOne('timetable_entries', { id });
    await announce(
      created,
      'class_assigned',
      'New class added',
      'A new class has been added to your routine. See the details below.',
    );
    res.status(201).json(entryOut(created));
  } catch (e) {
    next(e);
  }
});

timetableRouter.patch('/timetable/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await findOne('timetable_entries', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Class not found' });

    const isAdmin = req.session.role === 'super_admin';
    const ownsEntry = req.session.teacherInitial === existing.teacher_initial;
    if (!isAdmin && !ownsEntry) {
      return res.status(403).json({ error: 'You can only change your own classes' });
    }

    const body = req.body || {};
    const allowed = isAdmin
      ? [
          ...TEACHER_EDITABLE,
          'batch_id',
          'teacher_initial',
          'course_code',
          'section',
          'group_name',
        ]
      : TEACHER_EDITABLE;

    const patch = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (patch.section !== undefined) {
      patch.section = patch.section ? String(patch.section).trim().toUpperCase() : null;
      if (patch.group_name === undefined) patch.group_name = patch.section;
    } else if (patch.group_name !== undefined && patch.section === undefined) {
      const g = patch.group_name ? String(patch.group_name).trim().toUpperCase() : null;
      patch.group_name = g;
      patch.section = g;
    }
    if (patch.is_cancelled !== undefined) {
      patch.is_cancelled = Boolean(patch.is_cancelled);
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

    const errors = await validateEntry(patch, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const clashes = await conflictReport({ ...existing, ...patch });
    // Only an admin may knowingly keep a clash; a teacher has to pick another slot.
    if (clashes.length && !(isAdmin && body.force)) {
      return res.status(409).json({
        error: `This change clashes with ${clashes.length} other ${clashes.length === 1 ? 'class' : 'classes'}`,
        conflicts: clashes,
      });
    }

    await updateOne(
      'timetable_entries',
      { id: req.params.id },
      {
        $set: {
          ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, bind(v)])),
          updated_at: nowIso(),
        },
      },
    );

    const updated = await findOne('timetable_entries', { id: req.params.id });

    if (patch.is_cancelled !== undefined) {
      const cancelled = Boolean(patch.is_cancelled);
      await announce(
        updated,
        cancelled ? 'class_cancelled' : 'class_restored',
        cancelled ? 'Class cancelled' : 'Class restored',
        cancelled
          ? 'This class has been cancelled. Check the course, teacher, time, and room below.'
          : 'This class is back on your routine. Check the course, teacher, time, and room below.',
      );
    } else if (patch.room_id !== undefined) {
      await announce(
        updated,
        'room_changed',
        'Room changed',
        'The classroom for this class has changed. See the updated details below.',
      );
    } else if (patch.day || patch.start_time || patch.end_time) {
      await announce(
        updated,
        'class_rescheduled',
        'Class rescheduled',
        'This class has been rescheduled. See the new day, time, teacher, and room below.',
      );
    }

    res.json(entryOut(updated));
  } catch (e) {
    next(e);
  }
});

timetableRouter.delete('/timetable/:id', adminOnly, async (req, res, next) => {
  try {
    const existing = await findOne('timetable_entries', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Class not found' });
    await deleteOne('timetable_entries', { id: req.params.id });
    await announce(
      existing,
      'class_removed',
      'Class removed',
      'This class has been removed from the routine. Details of the removed class are below.',
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Bulk remove classes (no per-class email storm — for semester reset). */
timetableRouter.post('/timetable/bulk-delete', adminOnly, async (req, res, next) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: 'ids[] is required' });

    const result = await deleteMany('timetable_entries', { id: { $in: ids } });
    res.json({ ok: true, deleted: result.deletedCount || 0 });
  } catch (e) {
    next(e);
  }
});

timetableRouter.post('/timetable/import', adminOnly, async (req, res, next) => {
  try {
    const { entries, replace = false } = req.body || {};
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries[] is required' });

    const accepted = [];
    const rejected = [];
    for (let index = 0; index < entries.length; index += 1) {
      const raw = entries[index];
      const payload = {
        day: raw.day,
        batch_id: raw.batch_id,
        teacher_initial: raw.teacher_initial,
        course_code: raw.course_code,
        type: raw.type || 'Lecture',
        mode: raw.mode || 'Onsite',
        start_time: String(raw.start ?? raw.start_time ?? '').slice(0, 5),
        end_time: String(raw.end ?? raw.end_time ?? '').slice(0, 5),
        section: raw.section ?? raw.group ?? raw.group_name ?? null,
        group_name: raw.group ?? raw.group_name ?? raw.section ?? null,
        room_id: raw.room_id || null,
        is_cancelled: Boolean(raw.is_cancelled),
        cancellation_reason: raw.cancellation_reason ?? null,
      };
      const errors = await validateEntry(payload);
      if (errors.length) rejected.push({ row: index + 1, errors });
      else accepted.push(payload);
    }

    await transaction(async () => {
      if (replace) await deleteMany('timetable_entries', {});
      for (const e of accepted) {
        const section = e.section || e.group_name || null;
        const id = randomUUID();
        await insertOne('timetable_entries', {
          id,
          day: bind(e.day),
          batch_id: bind(e.batch_id),
          teacher_initial: bind(e.teacher_initial),
          course_code: bind(e.course_code),
          type: bind(e.type),
          section: bind(section),
          group_name: bind(e.group_name || section),
          room_id: bind(e.room_id),
          mode: bind(e.mode),
          start_time: bind(e.start_time),
          end_time: bind(e.end_time),
          is_cancelled: Boolean(e.is_cancelled),
          cancellation_reason: bind(e.cancellation_reason),
          created_at: nowIso(),
          updated_at: nowIso(),
        });
      }
    });

    // Imports are bulk data, so clashes are reported rather than blocked.
    const conflicts = findConflicts(
      (await findMany('timetable_entries', {})).map(entryOut),
    );
    res.json({
      imported: accepted.length,
      rejected,
      replaced: Boolean(replace),
      conflicts: summarize(conflicts),
    });
  } catch (e) {
    next(e);
  }
});
