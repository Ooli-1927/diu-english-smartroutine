import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { all, bind, get, run } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { notificationOut } from '../shape.js';
import { notifyAppointmentDecision, notifyAppointmentRequest } from '../notify.js';
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
    const rows = all(
      `SELECT * FROM notifications
       WHERE recipient_type = 'student'
         AND (recipient_id = ? OR recipient_id = ?)
       ORDER BY created_at DESC LIMIT 100`,
      [bind(batchId), bind(studentId)],
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
  const { teacher_initial: teacherInitial, date, time, purpose } = req.body || {};
  if (!teacherInitial || !date || !time) {
    return res.status(400).json({ error: 'teacher_initial, date and time are required' });
  }
  if (!String(purpose || '').trim()) {
    return res.status(400).json({ error: 'purpose / reason is required' });
  }
  if (!get('SELECT initial FROM teachers WHERE initial = ?', [teacherInitial])) {
    return res.status(400).json({ error: 'unknown teacher_initial' });
  }
  const id = randomUUID();
  run(
    `INSERT INTO appointments (id, teacher_initial, student_id, student_name, date, time, purpose, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      id,
      bind(teacherInitial),
      bind(req.session.studentId),
      bind(req.session.name),
      bind(date),
      bind(time),
      bind(String(purpose).trim()),
    ],
  );
  notifyAppointmentRequest({
    teacherInitial,
    studentName: req.session.name,
    date,
    time,
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
  const { status = existing.status, teacher_remarks: remarks = existing.teacher_remarks } = req.body || {};
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
