import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  bind,
  count,
  deleteOne,
  findMany,
  findOne,
  insertOne,
  nowIso,
  updateOne,
} from '../db.js';
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

miscRouter.post('/push/subscribe', requireAuth, async (req, res, next) => {
  try {
    if (!isPushConfigured()) {
      return res.status(503).json({ error: 'Web Push is not configured on the server' });
    }
    const id = await savePushSubscription(req.session, req.body);
    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

miscRouter.delete('/push/subscribe', requireAuth, async (req, res, next) => {
  try {
    await removePushSubscription(req.session, req.body?.endpoint);
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

miscRouter.get('/analytics', requireRole('super_admin'), async (_req, res, next) => {
  try {
    const entries = await findMany('timetable_entries', {});
    const totals = {
      teachers: await count('teachers'),
      students: await count('students'),
      batches: await count('batches'),
      courses: await count('courses'),
      rooms: await count('rooms'),
      classes: entries.length,
      cancelled: entries.filter((e) => Boolean(e.is_cancelled)).length,
    };

    const groupBy = (column) =>
      entries.reduce((acc, row) => {
        const key = row[column] ?? 'Unassigned';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

    res.json({
      totals,
      byDay: groupBy('day'),
      byType: groupBy('type'),
      byMode: groupBy('mode'),
      byBatch: groupBy('batch_id'),
      byTeacher: groupBy('teacher_initial'),
    });
  } catch (e) {
    next(e);
  }
});

/** Students see batch notices plus personal appointment replies. */
miscRouter.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const { role, batchId, teacherInitial, studentId } = req.session;
    if (role === 'super_admin') {
      const rows = await findMany(
        'notifications',
        {},
        { sort: { created_at: -1 }, limit: 100 },
      );
      return res.json(rows.map(notificationOut));
    }
    if (role === 'student') {
      const sectionKey =
        req.session.section && batchId ? `${batchId}:${req.session.section}` : null;
      const recipientIds = [batchId, studentId].filter(Boolean);
      if (sectionKey) recipientIds.push(sectionKey);
      const rows = await findMany(
        'notifications',
        {
          recipient_type: 'student',
          recipient_id: { $in: recipientIds },
        },
        { sort: { created_at: -1 }, limit: 100 },
      );
      return res.json(rows.map(notificationOut));
    }
    const rows = await findMany(
      'notifications',
      { recipient_type: 'teacher', recipient_id: teacherInitial },
      { sort: { created_at: -1 }, limit: 100 },
    );
    res.json(rows.map(notificationOut));
  } catch (e) {
    next(e);
  }
});

miscRouter.patch('/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    await updateOne('notifications', { id: req.params.id }, { $set: { is_read: true } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
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
  const is_active = body.is_active === false || body.is_active === 0 ? false : true;
  return { day, start_time, end_time, location, note, is_active };
}

function validateSlotTimes(day, start_time, end_time) {
  if (!SLOT_DAYS.includes(day)) return 'Pick a valid day (Sat–Fri)';
  if (!start_time || !end_time) return 'Start and end time are required';
  if (timeToMinutes(end_time) <= timeToMinutes(start_time)) return 'End time must be after start time';
  return null;
}

miscRouter.get('/appointment-slots', requireAuth, async (req, res, next) => {
  try {
    const queryTeacher = String(req.query.teacher_initial || '').trim();
    const own = requireTeacherInitial(req);

    if (req.session.role === 'student' && !queryTeacher) {
      const slots = await findMany('appointment_slots', { is_active: { $ne: false } });
      slots.sort((a, b) => {
        const t = String(a.teacher_initial).localeCompare(String(b.teacher_initial));
        if (t) return t;
        return String(a.start_time).localeCompare(String(b.start_time));
      });
      return res.json({ teacher_initial: null, slots: slots.map(slotOut), windows: [] });
    }

    if (req.session.role === 'super_admin' && !queryTeacher) {
      const slots = await findMany('appointment_slots', {});
      slots.sort((a, b) => {
        const t = String(a.teacher_initial).localeCompare(String(b.teacher_initial));
        if (t) return t;
        return String(a.start_time).localeCompare(String(b.start_time));
      });
      return res.json({
        teacher_initial: null,
        slots: slots.map(slotOut),
        windows: [],
      });
    }

    const initial = queryTeacher || own;
    if (!initial) return res.status(400).json({ error: 'teacher_initial is required' });
    if (!(await getTeacher(initial))) return res.status(400).json({ error: 'unknown teacher_initial' });

    const slots = await teacherSlots(initial, { activeOnly: req.session.role === 'student' });
    const windows = upcomingWindows(
      slots.filter((s) => s.is_active !== false && s.is_active !== 0),
      { daysAhead: 21 },
    );
    res.json({ teacher_initial: initial, slots: slots.map(slotOut), windows });
  } catch (err) {
    next(err);
  }
});

miscRouter.post('/appointment-slots', requireRole('teacher', 'teacher_admin', 'super_admin'), async (req, res, next) => {
  try {
    const own = requireTeacherInitial(req);
    const teacherInitial =
      req.session.role === 'super_admin' ? String(req.body?.teacher_initial || own || '').trim() : own;
    if (!teacherInitial) return res.status(400).json({ error: 'No teacher profile on this account' });
    if (!(await getTeacher(teacherInitial))) return res.status(400).json({ error: 'unknown teacher_initial' });

    const { day, start_time, end_time, location, note, is_active } = slotBody(req.body);
    const invalid = validateSlotTimes(day, start_time, end_time);
    if (invalid) return res.status(400).json({ error: invalid });

    const existing = await teacherSlots(teacherInitial, { activeOnly: false });
    const exact = existing.find(
      (s) =>
        s.day === day &&
        normalizeClock(s.start_time) === start_time &&
        normalizeClock(s.end_time) === end_time,
    );
    if (exact) {
      await updateOne(
        'appointment_slots',
        { id: exact.id },
        {
          $set: {
            location: bind(location),
            note: bind(note),
            is_active,
            updated_at: nowIso(),
          },
        },
      );
      return res.json(slotOut(await findOne('appointment_slots', { id: exact.id })));
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
      await insertOne('appointment_slots', {
        id,
        teacher_initial: bind(teacherInitial),
        day: bind(day),
        start_time: bind(start_time),
        end_time: bind(end_time),
        location: bind(location),
        note: bind(note),
        is_active,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    } catch (err) {
      const msg = String(err?.message || err);
      if (/duplicate|E11000|unique/i.test(msg)) {
        const row = await findOne('appointment_slots', {
          teacher_initial: teacherInitial,
          day,
          start_time,
          end_time,
        });
        if (row) return res.json(slotOut(row));
      }
      throw err;
    }
    res.status(201).json(slotOut(await findOne('appointment_slots', { id })));
  } catch (err) {
    next(err);
  }
});

miscRouter.patch('/appointment-slots/:id', requireRole('teacher', 'teacher_admin', 'super_admin'), async (req, res, next) => {
  try {
    const existing = await findOne('appointment_slots', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Slot not found' });
    const own = requireTeacherInitial(req);
    if (req.session.role !== 'super_admin' && existing.teacher_initial !== own) {
      return res.status(403).json({ error: 'Not your appointment slot' });
    }

    const nextSlot = {
      day: req.body?.day != null ? String(req.body.day).trim() : existing.day,
      start_time: req.body?.start_time != null ? normalizeClock(req.body.start_time) : normalizeClock(existing.start_time),
      end_time: req.body?.end_time != null ? normalizeClock(req.body.end_time) : normalizeClock(existing.end_time),
      location: req.body?.location != null ? String(req.body.location).trim() : existing.location || '',
      note: req.body?.note != null ? String(req.body.note).trim() : existing.note || '',
      is_active:
        req.body?.is_active === false || req.body?.is_active === 0
          ? false
          : req.body?.is_active === true || req.body?.is_active === 1
            ? true
            : existing.is_active !== false && existing.is_active !== 0,
    };
    const invalid = validateSlotTimes(nextSlot.day, nextSlot.start_time, nextSlot.end_time);
    if (invalid) return res.status(400).json({ error: invalid });

    await updateOne(
      'appointment_slots',
      { id: req.params.id },
      {
        $set: {
          day: bind(nextSlot.day),
          start_time: bind(nextSlot.start_time),
          end_time: bind(nextSlot.end_time),
          location: bind(nextSlot.location),
          note: bind(nextSlot.note),
          is_active: nextSlot.is_active,
          updated_at: nowIso(),
        },
      },
    );
    res.json(slotOut(await findOne('appointment_slots', { id: req.params.id })));
  } catch (e) {
    next(e);
  }
});

miscRouter.delete('/appointment-slots/:id', requireRole('teacher', 'teacher_admin', 'super_admin'), async (req, res, next) => {
  try {
    const existing = await findOne('appointment_slots', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Slot not found' });
    const own = requireTeacherInitial(req);
    if (req.session.role !== 'super_admin' && existing.teacher_initial !== own) {
      return res.status(403).json({ error: 'Not your appointment slot' });
    }
    await deleteOne('appointment_slots', { id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

miscRouter.get('/appointments', requireAuth, async (req, res, next) => {
  try {
    const { role, teacherInitial, studentId } = req.session;
    if (role === 'super_admin') {
      return res.json(await findMany('appointments', {}, { sort: { date: -1 } }));
    }
    if (role === 'student') {
      return res.json(
        await findMany('appointments', { student_id: studentId }, { sort: { date: -1 } }),
      );
    }
    res.json(
      await findMany(
        'appointments',
        { teacher_initial: teacherInitial },
        { sort: { date: -1 } },
      ),
    );
  } catch (e) {
    next(e);
  }
});

miscRouter.post('/appointments', requireRole('student'), async (req, res, next) => {
  try {
    const { teacher_initial: teacherInitial, date, time, purpose, slot_id: slotId } = req.body || {};
    if (!teacherInitial || !date || !time) {
      return res.status(400).json({ error: 'teacher_initial, date and time are required' });
    }
    if (!String(purpose || '').trim()) {
      return res.status(400).json({ error: 'purpose / reason is required' });
    }
    const teacher = await getTeacher(teacherInitial);
    if (!teacher) {
      return res.status(400).json({ error: 'unknown teacher_initial' });
    }

    const clock = normalizeClock(time);
    const isoDate = String(date).slice(0, 10);
    if (!weekdayFromDate(isoDate) || !clock) {
      return res.status(400).json({ error: 'Valid date and time are required' });
    }

    const published = await teacherSlots(teacher.initial, { activeOnly: true });
    if (!published.length) {
      return res.status(400).json({
        error: 'This teacher has not published an appointment schedule yet. Ask them to add slots in the teacher portal.',
      });
    }

    let slot = slotId
      ? published.find((s) => s.id === slotId)
      : await matchingSlot(teacher.initial, isoDate, clock);
    if (slotId && !slot) {
      return res.status(400).json({ error: 'That appointment slot is not available' });
    }
    if (!slot || !slotCovers(slot, isoDate, clock)) {
      return res.status(400).json({
        error: 'Pick a time inside this teacher’s published appointment schedule',
      });
    }

    if (await existingBooking(teacher.initial, isoDate, clock)) {
      return res.status(409).json({ error: 'That slot is already requested or booked' });
    }

    const id = randomUUID();
    await insertOne('appointments', {
      id,
      teacher_initial: bind(teacher.initial),
      student_id: bind(req.session.studentId),
      student_name: bind(req.session.name),
      date: bind(isoDate),
      time: bind(clock),
      purpose: bind(String(purpose).trim()),
      status: 'pending',
      slot_id: bind(slot.id),
      created_at: nowIso(),
    });
    await notifyAppointmentRequest({
      teacherInitial: teacher.initial,
      studentName: req.session.name,
      date: isoDate,
      time: clock,
      purpose: String(purpose).trim(),
      appointmentId: id,
    });
    res.status(201).json(await findOne('appointments', { id }));
  } catch (e) {
    next(e);
  }
});

miscRouter.patch('/appointments/:id', requireRole('teacher', 'teacher_admin', 'super_admin'), async (req, res, next) => {
  try {
    const existing = await findOne('appointments', { id: req.params.id });
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
    await updateOne(
      'appointments',
      { id: req.params.id },
      { $set: { status: bind(status), teacher_remarks: bind(remarks) } },
    );

    // Personal notice + email so the student sees the decision outside the batch feed.
    if (status !== existing.status) {
      await notifyAppointmentDecision({
        studentId: existing.student_id,
        teacherInitial: existing.teacher_initial,
        status,
        date: existing.date,
        time: existing.time,
        remarks,
        appointmentId: existing.id,
      });
    }

    res.json(await findOne('appointments', { id: req.params.id }));
  } catch (e) {
    next(e);
  }
});
