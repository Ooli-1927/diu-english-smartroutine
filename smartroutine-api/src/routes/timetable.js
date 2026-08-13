import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { all, bind, get, run, transaction } from '../db.js';
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

function validateEntry(payload, { partial = false } = {}) {
  const errors = [];
  const need = (key) => !partial || payload[key] !== undefined;

  if (need('day') && !DAYS.includes(payload.day)) errors.push('day must be one of ' + DAYS.join(', '));
  if (need('type') && !TYPES.includes(payload.type)) errors.push('type must be one of ' + TYPES.join(', '));
  if (need('mode') && !MODES.includes(payload.mode)) errors.push('mode must be one of ' + MODES.join(', '));
  if (need('start_time') && !/^\d{2}:\d{2}$/.test(payload.start_time || '')) errors.push('start_time must be HH:MM');
  if (need('end_time') && !/^\d{2}:\d{2}$/.test(payload.end_time || '')) errors.push('end_time must be HH:MM');

  if (!partial) {
    if (!get('SELECT id FROM batches WHERE id = ?', [payload.batch_id])) errors.push('unknown batch_id');
    if (!get('SELECT initial FROM teachers WHERE initial = ?', [payload.teacher_initial])) errors.push('unknown teacher_initial');
    if (!get('SELECT code FROM courses WHERE code = ?', [payload.course_code])) errors.push('unknown course_code');
  }
  if (payload.room_id && !get('SELECT id FROM rooms WHERE id = ?', [payload.room_id])) {
    errors.push('unknown room_id');
  }
  return errors;
}

function conflictReport(entry) {
  const others = all('SELECT * FROM timetable_entries WHERE day = ?', [entry.day]).map(entryOut);
  const conflicts = conflictsWith(entryOut(entry), others);
  return conflicts.map((c) => ({
    kind: c.kind,
    resource: c.resource,
    message: c.message,
    with: c.with,
  }));
}

timetableRouter.get('/timetable', requireAuth, (req, res) => {
  const clauses = [];
  const params = [];
  for (const [key, column] of [
    ['day', 'day'],
    ['batch_id', 'batch_id'],
    ['teacher_initial', 'teacher_initial'],
    ['room_id', 'room_id'],
  ]) {
    if (req.query[key]) {
      clauses.push(`${column} = ?`);
      params.push(req.query[key]);
    }
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = all(`SELECT * FROM timetable_entries${where} ORDER BY start_time`, params);
  res.json(rows.map(entryOut));
});

timetableRouter.get('/timetable/free-rooms', requireAuth, (req, res) => {
  const { day, start, end } = req.query;
  if (!day || !start || !end) {
    return res.status(400).json({ error: 'day, start and end are required' });
  }
  const busy = all(
    `SELECT DISTINCT room_id FROM timetable_entries
     WHERE day = ? AND is_cancelled = 0 AND room_id IS NOT NULL
       AND start_time < ? AND end_time > ?`,
    [day, end, start],
  ).map((r) => r.room_id);

  const rooms = all('SELECT * FROM rooms ORDER BY name');
  res.json({
    busy,
    free: rooms.filter((r) => !busy.includes(r.id)),
  });
});

/** Standing audit of the whole routine so clashes cannot hide in the data. */
timetableRouter.get('/timetable/conflicts', adminOnly, (_req, res) => {
  const entries = all('SELECT * FROM timetable_entries').map(entryOut);
  const conflicts = findConflicts(entries);
  res.json({ summary: summarize(conflicts), conflicts });
});

/** The current routine, collapsed into "what needs scheduling" rows. */
timetableRouter.get('/timetable/requirements', adminOnly, (req, res) => {
  const batchIds = String(req.query.batch_ids || '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  const where = batchIds.length
    ? ` WHERE batch_id IN (${batchIds.map(() => '?').join(',')})`
    : '';
  const rows = all(
    `SELECT batch_id, course_code, teacher_initial, type, mode, group_name, COUNT(*) AS sessions_per_week
     FROM timetable_entries${where}
     GROUP BY batch_id, course_code, teacher_initial, type, mode, group_name
     ORDER BY batch_id, course_code`,
    batchIds,
  );
  res.json(rows);
});

timetableRouter.get('/timetable/slots', adminOnly, (_req, res) => {
  const rows = all(
    `SELECT DISTINCT start_time AS start, end_time AS end FROM timetable_entries
     ORDER BY start_time`,
  );
  res.json({
    days: DEFAULT_DAYS,
    slots: rows.length ? rows : DEFAULT_SLOTS,
  });
});

timetableRouter.post('/timetable/generate', adminOnly, (req, res) => {
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
  requirements.forEach((r, i) => {
    if (!get('SELECT id FROM batches WHERE id = ?', [r.batch_id])) {
      invalid.push(`row ${i + 1}: unknown batch_id`);
    }
    if (!get('SELECT initial FROM teachers WHERE initial = ?', [r.teacher_initial])) {
      invalid.push(`row ${i + 1}: unknown teacher_initial`);
    }
    if (!get('SELECT code FROM courses WHERE code = ?', [r.course_code])) {
      invalid.push(`row ${i + 1}: unknown course_code`);
    }
    if (r.type && !TYPES.includes(r.type)) invalid.push(`row ${i + 1}: invalid type`);
    if (r.mode && !MODES.includes(r.mode)) invalid.push(`row ${i + 1}: invalid mode`);
  });
  if (invalid.length) return res.status(400).json({ error: invalid.join('; ') });

  const targetBatches = [...new Set(requirements.map((r) => r.batch_id))];
  const allEntries = all('SELECT * FROM timetable_entries');
  // When replacing, the batches being regenerated no longer block their own slots.
  const existing = replace
    ? allEntries.filter((e) => !targetBatches.includes(e.batch_id))
    : allEntries;

  const slotList = Array.isArray(slots) && slots.length ? slots : undefined;
  const dayList = Array.isArray(days) && days.length ? days : undefined;
  const useSlots =
    slotList ||
    (() => {
      const rows = all(
        'SELECT DISTINCT start_time AS start, end_time AS end FROM timetable_entries ORDER BY start_time',
      );
      return rows.length ? rows : DEFAULT_SLOTS;
    })();

  const result = generateSchedule({
    requirements,
    existing,
    rooms: all('SELECT * FROM rooms ORDER BY name'),
    days: dayList || DEFAULT_DAYS,
    slots: useSlots,
    maxPerBatchPerDay: Number(maxPerBatchPerDay) || 3,
    maxPerTeacherPerDay: Number(maxPerTeacherPerDay) || 4,
    soft: soft && typeof soft === 'object' ? soft : {},
  });

  if (dryRun) {
    return res.json({ ...result, applied: false, replaced: Boolean(replace) });
  }

  transaction(() => {
    if (replace && targetBatches.length) {
      run(
        `DELETE FROM timetable_entries WHERE batch_id IN (${targetBatches.map(() => '?').join(',')})`,
        targetBatches,
      );
    }
    for (const e of result.scheduled) {
      run(
        `INSERT INTO timetable_entries
          (id, day, batch_id, teacher_initial, course_code, type, group_name, room_id, mode, start_time, end_time, is_cancelled, cancellation_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
        [
          randomUUID(),
          bind(e.day),
          bind(e.batch_id),
          bind(e.teacher_initial),
          bind(e.course_code),
          bind(e.type),
          bind(e.group_name),
          bind(e.room_id),
          bind(e.mode),
          bind(e.start_time),
          bind(e.end_time),
        ],
      );
    }
  });

  const conflicts = findConflicts(all('SELECT * FROM timetable_entries').map(entryOut));
  res.json({
    ...result,
    applied: true,
    replaced: Boolean(replace),
    conflicts: summarize(conflicts),
  });
});

timetableRouter.post('/timetable', adminOnly, (req, res) => {
  const payload = req.body || {};
  const errors = validateEntry(payload);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const clashes = conflictReport(payload);
  if (clashes.length && !payload.force) {
    return res.status(409).json({
      error: `This class clashes with ${clashes.length} existing ${clashes.length === 1 ? 'class' : 'classes'}`,
      conflicts: clashes,
    });
  }

  const id = payload.id || randomUUID();
  run(
    `INSERT INTO timetable_entries
      (id, day, batch_id, teacher_initial, course_code, type, group_name, room_id, mode, start_time, end_time, is_cancelled, cancellation_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      bind(payload.day),
      bind(payload.batch_id),
      bind(payload.teacher_initial),
      bind(payload.course_code),
      bind(payload.type),
      bind(payload.group_name),
      bind(payload.room_id),
      bind(payload.mode),
      bind(payload.start_time),
      bind(payload.end_time),
      payload.is_cancelled ? 1 : 0,
      bind(payload.cancellation_reason),
    ],
  );

  const created = get('SELECT * FROM timetable_entries WHERE id = ?', [id]);
  announce(
    created,
    'class_assigned',
    'New class added',
    'A new class has been added to your routine. See the details below.',
  );
  res.status(201).json(entryOut(created));
});

timetableRouter.patch('/timetable/:id', requireAuth, (req, res) => {
  const existing = get('SELECT * FROM timetable_entries WHERE id = ?', [req.params.id]);
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
        'group_name',
      ]
    : TEACHER_EDITABLE;

  const patch = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

  const errors = validateEntry(patch, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const clashes = conflictReport({ ...existing, ...patch });
  // Only an admin may knowingly keep a clash; a teacher has to pick another slot.
  if (clashes.length && !(isAdmin && body.force)) {
    return res.status(409).json({
      error: `This change clashes with ${clashes.length} other ${clashes.length === 1 ? 'class' : 'classes'}`,
      conflicts: clashes,
    });
  }

  const sets = Object.keys(patch).map((k) => `${k} = ?`);
  const params = Object.keys(patch).map((k) => bind(patch[k]));
  sets.push('updated_at = CURRENT_TIMESTAMP');
  run(`UPDATE timetable_entries SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);

  const updated = get('SELECT * FROM timetable_entries WHERE id = ?', [req.params.id]);

  if (patch.is_cancelled !== undefined) {
    const cancelled = Boolean(patch.is_cancelled);
    announce(
      updated,
      cancelled ? 'class_cancelled' : 'class_restored',
      cancelled ? 'Class cancelled' : 'Class restored',
      cancelled
        ? 'This class has been cancelled. Check the course, teacher, time, and room below.'
        : 'This class is back on your routine. Check the course, teacher, time, and room below.',
    );
  } else if (patch.room_id !== undefined) {
    announce(
      updated,
      'room_changed',
      'Room changed',
      'The classroom for this class has changed. See the updated details below.',
    );
  } else if (patch.day || patch.start_time || patch.end_time) {
    announce(
      updated,
      'class_rescheduled',
      'Class rescheduled',
      'This class has been rescheduled. See the new day, time, teacher, and room below.',
    );
  }

  res.json(entryOut(updated));
});

timetableRouter.delete('/timetable/:id', adminOnly, (req, res) => {
  const existing = get('SELECT * FROM timetable_entries WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Class not found' });
  run('DELETE FROM timetable_entries WHERE id = ?', [req.params.id]);
  announce(
    existing,
    'class_removed',
    'Class removed',
    'This class has been removed from the routine. Details of the removed class are below.',
  );
  res.json({ ok: true });
});

timetableRouter.post('/timetable/import', adminOnly, (req, res) => {
  const { entries, replace = false } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries[] is required' });

  const accepted = [];
  const rejected = [];
  entries.forEach((raw, index) => {
    const payload = {
      day: raw.day,
      batch_id: raw.batch_id,
      teacher_initial: raw.teacher_initial,
      course_code: raw.course_code,
      type: raw.type || 'Lecture',
      mode: raw.mode || 'Onsite',
      start_time: String(raw.start ?? raw.start_time ?? '').slice(0, 5),
      end_time: String(raw.end ?? raw.end_time ?? '').slice(0, 5),
      group_name: raw.group ?? raw.group_name ?? null,
      room_id: raw.room_id || null,
      is_cancelled: raw.is_cancelled ? 1 : 0,
      cancellation_reason: raw.cancellation_reason ?? null,
    };
    const errors = validateEntry(payload);
    if (errors.length) rejected.push({ row: index + 1, errors });
    else accepted.push(payload);
  });

  transaction(() => {
    if (replace) run('DELETE FROM timetable_entries', []);
    for (const e of accepted) {
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
          bind(e.type),
          bind(e.group_name),
          bind(e.room_id),
          bind(e.mode),
          bind(e.start_time),
          bind(e.end_time),
          bind(e.is_cancelled),
          bind(e.cancellation_reason),
        ],
      );
    }
  });

  // Imports are bulk data, so clashes are reported rather than blocked.
  const conflicts = findConflicts(all('SELECT * FROM timetable_entries').map(entryOut));
  res.json({
    imported: accepted.length,
    rejected,
    replaced: Boolean(replace),
    conflicts: summarize(conflicts),
  });
});
