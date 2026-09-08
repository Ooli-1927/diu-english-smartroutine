import { randomUUID } from 'node:crypto';
import { bind, findMany, findOne, insertOne, caseInsensitive } from './db.js';
import { queueMail, queueMails } from './mail.js';
import { sendPushForNotification } from './push.js';
import { queueSyncForEntry } from './googleCalendar.js';

async function insertNotification({ type, title, body, recipientType, recipientId, entryId }) {
  const id = randomUUID();
  await insertOne('notifications', {
    id,
    type: bind(type),
    title: bind(title),
    body: bind(body),
    recipient_type: bind(recipientType),
    recipient_id: bind(recipientId),
    related_entry_id: bind(entryId),
    is_read: false,
  });
  return id;
}

async function studentEmailsForBatch(batchId, section = null) {
  const filter = {
    batch_id: batchId,
    email: { $nin: [null, ''] },
  };
  if (section) {
    Object.assign(filter, caseInsensitive('section', section));
  }
  const rows = await findMany('students', filter);
  return rows.filter((s) => s.email && String(s.email).trim());
}

async function teacherByInitial(initial) {
  return findOne('teachers', { initial });
}

async function studentByStudentId(studentId) {
  return findOne('students', {
    $or: [{ student_id: studentId }, { id: studentId }],
  });
}

const CTA = {
  student: { label: 'View in student portal', path: '/student/notifications' },
  teacher: { label: 'View in teacher portal', path: '/teacher/notifications' },
  appointmentStudent: { label: 'Open appointments', path: '/student/appointments' },
  appointmentTeacher: { label: 'Open appointments', path: '/teacher/appointments' },
};

function sliceTime(t) {
  return String(t || '').slice(0, 5);
}

/** Resolve course / teacher / room labels for a timetable entry. */
export async function classContext(entry) {
  if (!entry) {
    return {
      details: [],
      courseCode: '',
      courseTitle: '',
      teacherName: '',
      teacherLabel: '',
      roomLabel: '',
      start: '',
      end: '',
      day: '',
    };
  }

  const course = await findOne('courses', { code: entry.course_code });
  const teacher = await findOne('teachers', { initial: entry.teacher_initial });
  const room = entry.room_id
    ? await findOne('rooms', {
        $or: [{ id: entry.room_id }, { name: entry.room_id }],
      })
    : null;
  const batch = entry.batch_id ? await findOne('batches', { id: entry.batch_id }) : null;

  const courseCode = entry.course_code || '—';
  const courseTitle = course?.title || '—';
  const teacherName = teacher?.name || entry.teacher_initial || '—';
  const teacherLabel = teacher
    ? `${teacher.name}${teacher.designation ? ` · ${teacher.designation}` : ''} (${teacher.initial})`
    : entry.teacher_initial || '—';
  const roomLabel =
    entry.mode === 'Online'
      ? 'Online'
      : room?.name || entry.room_id || 'TBA';
  const start = sliceTime(entry.start_time);
  const end = sliceTime(entry.end_time);

  const details = [
    { label: 'Course code', value: courseCode },
    { label: 'Course name', value: courseTitle },
    { label: 'Teacher', value: teacherLabel },
    { label: 'Day', value: entry.day || '—' },
    { label: 'Time', value: start && end ? `${start} – ${end}` : '—' },
    { label: 'Classroom', value: roomLabel },
    { label: 'Class type', value: entry.type || '—' },
    { label: 'Mode', value: entry.mode || '—' },
  ];
  if (batch) {
    details.push({
      label: 'Batch',
      value: `${batch.name} (${batch.session})${entry.section || entry.group_name ? ` · Section ${entry.section || entry.group_name}` : ''}`,
    });
  }
  if (entry.section || entry.group_name) {
    details.push({ label: 'Section', value: entry.section || entry.group_name });
  }
  if (entry.cancellation_reason) {
    details.push({ label: 'Reason', value: String(entry.cancellation_reason) });
  }

  return {
    details,
    courseCode,
    courseTitle,
    teacherName,
    teacherLabel,
    roomLabel,
    start,
    end,
    day: entry.day || '',
  };
}

function detailsPlainText(details) {
  if (!details?.length) return '';
  return ['', 'Class details:', ...details.map((d) => `${d.label}: ${d.value}`)].join('\n');
}

/**
 * Persist in-app notice + fan-out email(s). Mail is queued so API responses stay fast.
 */
export async function notify({
  type,
  title,
  body,
  recipientType,
  recipientId,
  entryId,
  emailCta,
  subject,
  details,
  emailBody,
}) {
  await insertNotification({ type, title, body, recipientType, recipientId, entryId });

  void sendPushForNotification({
    type,
    title,
    body: emailBody || body,
    recipientType,
    recipientId,
  }).catch((err) => {
    console.warn('Web Push notify failed:', err?.message || err);
  });

  const cta =
    emailCta ||
    (recipientType === 'teacher' ? CTA.teacher : CTA.student);
  const mailSubject = subject || title;
  const intro = emailBody || body;

  if (recipientType === 'student') {
    const [batchPart, sectionPart] = String(recipientId || '').includes(':')
      ? String(recipientId).split(':')
      : [recipientId, null];
    const sectionNorm = sectionPart ? String(sectionPart).trim().toUpperCase() : null;
    const batchStudents = await studentEmailsForBatch(batchPart, sectionNorm);
    if (batchStudents.length) {
      queueMails(
        batchStudents.map((s) => ({
          to: s.email,
          subject: mailSubject,
          title,
          body: `Hi ${s.name},\n\n${intro}`,
          details,
          ctaLabel: cta.label,
          ctaPath: cta.path,
          category: type,
        })),
      );
      return;
    }

    const one = await studentByStudentId(recipientId);
    if (one?.email) {
      queueMail({
        to: one.email,
        subject: mailSubject,
        title,
        body: `Hi ${one.name},\n\n${intro}`,
        details,
        ctaLabel: cta.label,
        ctaPath: cta.path,
        category: type,
      });
    }
    return;
  }

  if (recipientType === 'teacher') {
    const t = await teacherByInitial(recipientId);
    if (t?.email) {
      queueMail({
        to: t.email,
        subject: mailSubject,
        title,
        body: `Hi ${t.name},\n\n${intro}`,
        details,
        ctaLabel: cta.label,
        ctaPath: cta.path,
        category: type,
      });
    }
  }
}

/** Class change: students in that batch section + owning teacher. */
export async function announce(entry, type, title, body) {
  const ctx = await classContext(entry);
  const noticeBody = `${body}${detailsPlainText(ctx.details)}`;
  const subject = [
    title,
    ctx.courseCode,
    ctx.teacherName,
    ctx.day && ctx.start ? `${ctx.day} ${ctx.start}` : ctx.day,
    ctx.roomLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  const sectionRaw = entry.section || entry.group_name || null;
  const section = sectionRaw ? String(sectionRaw).trim().toUpperCase() : null;
  const studentRecipient = section ? `${entry.batch_id}:${section}` : entry.batch_id;

  await notify({
    type,
    title,
    subject,
    body: noticeBody,
    emailBody: body,
    details: ctx.details,
    recipientType: 'student',
    recipientId: studentRecipient,
    entryId: entry.id,
  });
  await notify({
    type,
    title,
    subject,
    body: noticeBody,
    emailBody: body,
    details: ctx.details,
    recipientType: 'teacher',
    recipientId: entry.teacher_initial,
    entryId: entry.id,
  });

  await queueSyncForEntry(entry);
}

export async function notifyAppointmentRequest({
  teacherInitial,
  studentName,
  date,
  time,
  purpose,
  appointmentId,
}) {
  await notify({
    type: 'appointment',
    title: 'New appointment request',
    body: `${studentName} requested ${date} at ${time}: ${purpose}`,
    recipientType: 'teacher',
    recipientId: teacherInitial,
    entryId: appointmentId,
    emailCta: CTA.appointmentTeacher,
  });
}

export async function notifyAppointmentDecision({
  studentId,
  teacherInitial,
  status,
  date,
  time,
  remarks,
  appointmentId,
}) {
  const teacher = await teacherByInitial(teacherInitial);
  const teacherLabel = teacher?.name
    ? `${teacher.name} (${teacher.initial})`
    : teacherInitial;
  const title =
    status === 'accepted'
      ? 'Appointment accepted'
      : status === 'rejected'
        ? 'Appointment declined'
        : 'Appointment updated';
  const bodyParts = [
    `${teacherLabel} marked your request for ${date} ${time} as ${status}`,
  ];
  if (remarks) bodyParts.push(String(remarks));

  await notify({
    type: 'appointment',
    title,
    subject: `${title} · ${teacherLabel} · ${date} ${time}`,
    body: bodyParts.join(' — '),
    details: [
      { label: 'Teacher', value: teacherLabel },
      { label: 'Date', value: date },
      { label: 'Time', value: time },
      { label: 'Status', value: status },
      ...(remarks ? [{ label: 'Remarks', value: String(remarks) }] : []),
    ],
    recipientType: 'student',
    recipientId: studentId,
    entryId: appointmentId,
    emailCta: CTA.appointmentStudent,
  });
}
