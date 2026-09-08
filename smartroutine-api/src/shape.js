export function teacherOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    initial: row.initial,
    designation: row.designation,
    phone: row.phone,
    email: row.email,
    home_department: row.home_department,
    profile_pic: row.profile_pic,
    has_changed_password: Boolean(row.has_changed_password),
  };
}

export function studentOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    student_id: row.student_id,
    name: row.name,
    batch_id: row.batch_id,
    section: row.section || null,
    email: row.email,
    phone: row.phone,
    profile_pic: row.profile_pic || null,
    has_changed_password: Boolean(row.has_changed_password),
  };
}

export function entryOut(row) {
  if (!row) return null;
  const section = row.section || null;
  return {
    id: row.id,
    day: row.day,
    batch_id: row.batch_id,
    teacher_initial: row.teacher_initial,
    course_code: row.course_code,
    type: row.type,
    section,
    group_name: row.group_name || section,
    room_id: row.room_id,
    mode: row.mode,
    start_time: String(row.start_time).slice(0, 5),
    end_time: String(row.end_time).slice(0, 5),
    is_cancelled: Boolean(row.is_cancelled),
    cancellation_reason: row.cancellation_reason,
  };
}

export function notificationOut(row) {
  if (!row) return null;
  return { ...row, is_read: Boolean(row.is_read) };
}
