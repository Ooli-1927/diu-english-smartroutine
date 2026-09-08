import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { all, bind, get, run } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { notificationOut } from '../shape.js';
import { notifyAppointmentDecision, notifyAppointmentRequest } from '../notify.js';
import {
  SLOT_DAYS,
  existingBooking,
  getTeacher,
  matchingSlot,
  normalizeClock,
  slotCovers,
  slotOut,
  teacherSlots,
  timeToMinutes,
  upcomingWindows,
  weekdayFromDate,
} from '../appointmentSlots.js';
import {
  clearSmtpConfig,
  isMailConfigured,
  mailStatus,
  saveSmtpConfig,
  sendTestMail,
} from '../mail.js';
import {
  getVapidPublicKey,
  isPushConfigured,
  removePushSubscription,
  savePushSubscription,
} from '../push.js';

export const miscRouter = Router();

/** Public key only — safe for the browser to fetch before subscribe. */
miscRouter.get('/push/vapid-public-key', (_req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({
      error: 'Web Push is not configured on the server',
      configured: false,
    });
  }
  res.json({ publicKey, configured: true });
});

miscRouter.get('/push/status', requireAuth, (_req, res) => {
  res.json({ configured: isPushConfigured() });
});

miscRouter.post('/push/subscribe', requireAuth, (req, res, next) => {
  try {
    if (!isPushConfigured()) {
      return res.status(503).json({ error: 'Web Push is not configured on the server' });
    }
    const id = savePushSubscription(req.session, req.body);
    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

miscRouter.delete('/push/subscribe', requireAuth, (req, res, next) => {
  try {
    removePushSubscription(req.session, req.body?.endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

miscRouter.get('/mail/status', requireRole('super_admin'), (_req, res) => {
  res.json(mailStatus());
});

miscRouter.put('/mail/smtp', requireRole('super_admin'), (req, res, next) => {
  try {
    const status = saveSmtpConfig({
      user: req.body?.user,
      pass: req.body?.pass,
      from: req.body?.from,
      fromName: req.body?.fromName,
      service: req.body?.service,
      host: req.body?.host,
      port: req.body?.port,
    });
    res.json(status);
  } catch (err) {
    next(err);
  }
});

miscRouter.delete('/mail/smtp', requireRole('super_admin'), (_req, res, next) => {
  try {
    res.json(clearSmtpConfig());
  } catch (err) {
    next(err);
  }
});

miscRouter.post('/mail/test', requireRole('super_admin'), async (req, res, next) => {
  try {
    const to = String(req.body?.to || '').trim();
    if (!to) return res.status(400).json({ error: 'to email is required' });
    if (!isMailConfigured()) {
      return res.status(503).json({ error: 'Mail delivery is disabled (MAIL_HTTP_DISABLED=1 and no SMTP).' });
    }
    const result = await sendTestMail(to);
    res.json({
      ok: true,
      messageId: result.messageId,
      to: result.to,
      mode: result.mode,
      needsConfirm: Boolean(result.needsConfirm),
      note: result.note || null,
      professional: !String(result.mode || '').startsWith('http'),
    });
  } catch (err) {
    next(err);
  }
});

miscRouter.get('/analytics', requireRole('super_admin'), (_req, res) => {
  const totals = {
    teachers: get('SELECT COUNT(*) AS n FROM teachers').n,
    students: get('SELECT COUNT(*) AS n FROM students').n,
    batches: get('SELECT COUNT(*) AS n FROM batches').n,
    courses: get('SELECT COUNT(*) AS n FROM courses').n,
    rooms: get('SELECT COUNT(*) AS n FROM rooms').n,
    classes: get('SELECT COUNT(*) AS n FROM timetable_entries').n,
    cancelled: get('SELECT COUNT(*) AS n FROM timetable_entries WHERE is_cancelled = 1').n,
  };

  const groupBy = (column) =>
    all(`SELECT ${column} AS key, COUNT(*) AS count FROM timetable_entries GROUP BY ${column}`)
      .reduce((acc, row) => ({ ...acc, [row.key ?? 'Unassigned']: row.count }), {});

  res.json({
    totals,
    byDay: groupBy('day'),
    byType: groupBy('type'),
    byMode: groupBy('mode'),
    byBatch: groupBy('batch_id'),
    byTeacher: groupBy('teacher_initial'),
  });
});

/** Students see batch notices plus personal appointment replies. */
miscRouter.get('/notifications', requireAuth, (req, res) => {
  const { role, batchId, teacherInitial, studentId } = req.session;
  if (role === 'super_admin') {
    return res.json(
      all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').map(notificationOut),
    );
  }
  if (role === 'student') {
    const sectionKey =
      req.session.section && batchId ? `${batchId}:${req.session.section}` : null;
    const rows = all(
      `SELECT * FROM notifications
       WHERE recipient_type = 'student'
         AND (recipient_id = ? OR recipient_id = ?${sectionKey ? ' OR recipient_id = ?' : ''})
       ORDER BY created_at DESC LIMIT 100`,
      sectionKey
        ? [bind(batchId), bind(studentId), bind(sectionKey)]
        : [bind(batchId), bind(studentId)],
    );
    return res.json(rows.map(notificationOut));
  }
  res.json(
    all(
      'SELECT * FROM notifications WHERE recipient_type = ? AND recipient_id = ? ORDER BY created_at DESC LIMIT 100',
      ['teacher', bind(teacherInitial)],
    ).map(notificationOut),
  );
});

miscRouter.patch('/notifications/:id/read', requireAuth, (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

function requireTeacherInitial(req) {
  return req.session?.teacherInitial || null;
}

function slotBody(body = {}) {
  const day = String(body.day || '').trim();
  const start_time = normalizeClock(body.start_time);
  const end_time = normalizeClock(body.end_time);
  const location = String(body.location || '').trim();
  const note = String(body.note || '').trim();
  const is_active = body.is_active === false || body.is_active === 0 ? 0 : 1;
  return { day, start_time, end_time, location, note, is_active };
}

function validateSlotTimes(day, start_time, end_time) {
  if (!SLOT_DAYS.includes(day)) return 'Pick a valid day (Sat–Fri)';
  if (!start_time || !end_time) return 'Start and end time are required';
  if (timeToMinutes(end_time) <= timeToMinutes(start_time)) return 'End time must be after start time';
  return null;
}

miscRouter.get('/appointment-slots', requireAuth, (req, res, next) => {
  try {
    const queryTeacher = String(req.query.teacher_initial || '').trim();
    const own = requireTeacherInitial(req);

    if (req.session.role === 'student' && !queryTeacher) {
      const slots = all(
        `SELECT * FROM appointment_slots WHERE is_active = 1
         ORDER BY teacher_initial, start_time`,
      );
      return res.json({ teacher_initial: null, slots: slots.map(slotOut), windows: [] });
    }

    if (req.session.role === 'super_admin' && !queryTeacher) {
      return res.json({
        teacher_initial: null,
        slots: all('SELECT * FROM appointment_slots ORDER BY teacher_initial, start_time').map(slotOut),
        windows: [],
      });
    }

    const initial = queryTeacher || own;
    if (!initial) return res.status(400).json({ error: 'teacher_initial is required' });
    if (!getTeacher(initial)) return res.status(400).json({ error: 'unknown teacher_initial' });

    const slots = teacherSlots(initial, { activeOnly: req.session.role === 'student' });
    const windows = upcomingWindows(
      slots.filter((s) => s.is_active),
      { daysAhead: 21 },
    );
    res.json({ teacher_initial: initial, slots: slots.map(slotOut), windows });
  } catch (err) {
    next(err);
  }
});

miscRouter.post('/appointment-slots', requireRole('teacher', 'teacher_admin', 'super_admin'), (req, res, next) => {
  try {
    const own = requireTeacherInitial(req);
    const teacherInitial =
      req.session.role === 'super_admin' ? String(req.body?.teacher_initial || own || '').trim() : own;
    if (!teacherInitial) return res.status(400).json({ error: 'No teacher profile on this account' });
    if (!getTeacher(teacherInitial)) return res.status(400).json({ error: 'unknown teacher_initial' });

    const { day, start_time, end_time, location, note, is_active } = slotBody(req.body);
    const invalid = validateSlotTimes(day, start_time, end_time);
    if (invalid) return res.status(400).json({ error: invalid });

    const existing = teacherSlots(teacherInitial, { activeOnly: false });
    const exact = existing.find(
      (s) =>
        s.day === day &&
        normalizeClock(s.start_time) === start_time &&
        normalizeClock(s.end_time) === end_time,
    );
    if (exact) {
      run(
        `UPDATE appointment_slots
         SET location = ?, note = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [bind(location), bind(note), is_active, exact.id],
      );
      return res.json(slotOut(get('SELECT * FROM appointment_slots WHERE id = ?', [exact.id])));
    }

    const clash = existing.find((s) => {
      if (s.day !== day) return false;
      const a1 = timeToMinutes(s.start_time);
      const a2 = timeToMinutes(s.end_time);
      const b1 = timeToMinutes(start_time);
      const b2 = timeToMinutes(end_time);
      return a1 < b2 && b1 < a2;
    });
    if (clash) {
      return res.status(409).json({
        error: `Overlaps an existing slot on ${day} (${normalizeClock(clash.start_time)}–${normalizeClock(clash.end_time)})`,
      });
    }

    const id = randomUUID();
    try {
      run(
        `INSERT INTO appointment_slots (id, teacher_initial, day, start_time, end_time, location, note, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, bind(teacherInitial), bind(day), bind(start_time), bind(end_time), bind(location), bind(note), is_active],
      );
    } catch (err) {
      const msg = String(err?.message || err);
      if (/UNIQUE|unique/i.test(msg)) {
        const row = get(
          `SELECT * FROM appointment_slots
           WHERE teacher_initial = ? AND day = ? AND start_time = ? AND end_time = ?`,
          [bind(teacherInitial), bind(day), bind(start_time), bind(end_time)],
        );
        if (row) return res.json(slotOut(row));
      }
      throw err;
    }
    res.status(201).json(slotOut(get('SELECT * FROM appointment_slots WHERE id = ?', [id])));
  } catch (err) {
    next(err);
  }
});

miscRouter.patch('/appointment-slots/:id', requireRole('teacher', 'teacher_admin', 'super_admin'), (req, res) => {
  const existing = get('SELECT * FROM appointment_slots WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Slot not found' });
  const own = requireTeacherInitial(req);
  if (req.session.role !== 'super_admin' && existing.teacher_initial !== own) {
    return res.status(403).json({ error: 'Not your appointment slot' });
  }

  const next = {
    day: req.body?.day != null ? String(req.body.day).trim() : existing.day,
    start_time: req.body?.start_time != null ? normalizeClock(req.body.start_time) : normalizeClock(existing.start_time),
    end_time: req.body?.end_time != null ? normalizeClock(req.body.end_time) : normalizeClock(existing.end_time),
    location: req.body?.location != null ? String(req.body.location).trim() : existing.location || '',
    note: req.body?.note != null ? String(req.body.note).trim() : existing.note || '',
    is_active:
      req.body?.is_active === false || req.body?.is_active === 0
        ? 0
        : req.body?.is_active === true || req.body?.is_active === 1
          ? 1
          : existing.is_active,
  };
  const invalid = validateSlotTimes(next.day, next.start_time, next.end_time);
  if (invalid) return res.status(400).json({ error: invalid });

  run(
    `UPDATE appointment_slots
     SET day = ?, start_time = ?, end_time = ?, location = ?, note = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      bind(next.day),
      bind(next.start_time),
      bind(next.end_time),
      bind(next.location),
      bind(next.note),
      next.is_active,
      req.params.id,
    ],
  );
  res.json(slotOut(get('SELECT * FROM appointment_slots WHERE id = ?', [req.params.id])));
});

miscRouter.delete('/appointment-slots/:id', requireRole('teacher', 'teacher_admin', 'super_admin'), (req, res) => {
  const existing = get('SELECT * FROM appointment_slots WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Slot not found' });
  const own = requireTeacherInitial(req);
  if (req.session.role !== 'super_admin' && existing.teacher_initial !== own) {
    return res.status(403).json({ error: 'Not your appointment slot' });
  }
  run('DELETE FROM appointment_slots WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

miscRouter.get('/appointments', requireAuth, (req, res) => {
  const { role, teacherInitial, studentId } = req.session;
  if (role === 'super_admin') {
    return res.json(all('SELECT * FROM appointments ORDER BY date DESC'));
  }
  if (role === 'student') {
    return res.json(
      all('SELECT * FROM appointments WHERE student_id = ? ORDER BY date DESC', [bind(studentId)]),
    );
  }
  res.json(
    all('SELECT * FROM appointments WHERE teacher_initial = ? ORDER BY date DESC', [
      bind(teacherInitial),
    ]),
  );
});

miscRouter.post('/appointments', requireRole('student'), (req, res) => {
  const { teacher_initial: teacherInitial, date, time, purpose, slot_id: slotId } = req.body || {};
  if (!teacherInitial || !date || !time) {
    return res.status(400).json({ error: 'teacher_initial, date and time are required' });
  }
  if (!String(purpose || '').trim()) {
    return res.status(400).json({ error: 'purpose / reason is required' });
  }
  const teacher = getTeacher(teacherInitial);
  if (!teacher) {
    return res.status(400).json({ error: 'unknown teacher_initial' });
  }

  const clock = normalizeClock(time);
  const isoDate = String(date).slice(0, 10);
  if (!weekdayFromDate(isoDate) || !clock) {
    return res.status(400).json({ error: 'Valid date and time are required' });
  }

  const published = teacherSlots(teacher.initial, { activeOnly: true });
  if (!published.length) {
    return res.status(400).json({
      error: 'This teacher has not published an appointment schedule yet. Ask them to add slots in the teacher portal.',
    });
  }

  let slot = slotId
    ? published.find((s) => s.id === slotId)
    : matchingSlot(teacher.initial, isoDate, clock);
  if (slotId && !slot) {
    return res.status(400).json({ error: 'That appointment slot is not available' });
  }
  if (!slot || !slotCovers(slot, isoDate, clock)) {
    return res.status(400).json({
      error: 'Pick a time inside this teacher’s published appointment schedule',
    });
  }

  if (existingBooking(teacher.initial, isoDate, clock)) {
    return res.status(409).json({ error: 'That slot is already requested or booked' });
  }

  const id = randomUUID();
  run(
    `INSERT INTO appointments (id, teacher_initial, student_id, student_name, date, time, purpose, status, slot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      id,
      bind(teacher.initial),
      bind(req.session.studentId),
      bind(req.session.name),
      bind(isoDate),
      bind(clock),
      bind(String(purpose).trim()),
      bind(slot.id),
    ],
  );
  notifyAppointmentRequest({
    teacherInitial: teacher.initial,
    studentName: req.session.name,
    date: isoDate,
    time: clock,
    purpose: String(purpose).trim(),
    appointmentId: id,
  });
  res.status(201).json(get('SELECT * FROM appointments WHERE id = ?', [id]));
});

miscRouter.patch('/appointments/:id', requireRole('teacher', 'teacher_admin', 'super_admin'), (req, res) => {
  const existing = get('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Appointment not found' });
  if (req.session.role !== 'super_admin' && req.session.teacherInitial !== existing.teacher_initial) {
    return res.status(403).json({ error: 'Not your appointment' });
  }
  const rawStatus = req.body?.status ?? existing.status;
  const status = rawStatus === 'declined' ? 'rejected' : rawStatus;
  const remarks = req.body?.teacher_remarks ?? existing.teacher_remarks;
  if (!['pending', 'accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  run('UPDATE appointments SET status = ?, teacher_remarks = ? WHERE id = ?', [
    bind(status),
    bind(remarks),
    req.params.id,
  ]);

  // Personal notice + email so the student sees the decision outside the batch feed.
  if (status !== existing.status) {
    notifyAppointmentDecision({
      studentId: existing.student_id,
      teacherInitial: existing.teacher_initial,
      status,
      date: existing.date,
      time: existing.time,
      remarks,
      appointmentId: existing.id,
    });
  }

  res.json(get('SELECT * FROM appointments WHERE id = ?', [req.params.id]));
});
