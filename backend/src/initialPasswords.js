/**
 * Initial (department-issued) password rules for SmartRoutine.
 * Users may change once; Chairman resets via admin UI.
 */

export const CHAIRMAN_USERNAME = 'Chairman';
export const CHAIRMAN_PASSWORD = 'Chairman123';
export const STUDENT_INITIAL_PASSWORD = '12345678';

/** Teacher / teacher-admin initial password: INITIAL + "123" (e.g. ZTF → ZTF123). */
export function teacherInitialPassword(initial) {
  return `${String(initial || '').trim().toUpperCase()}123`;
}

/** Normalize admin username from seed data (chairman → Chairman). */
export function normalizeAdminUsername(username) {
  if (String(username || '').trim().toLowerCase() === 'chairman') {
    return CHAIRMAN_USERNAME;
  }
  return String(username || '').trim();
}

/** Password for an admin row at seed / create time. */
export function adminInitialPassword(username, type, teacherInitial) {
  const u = normalizeAdminUsername(username);
  if (u.toLowerCase() === 'chairman' || type === 'super_admin') {
    // Chairman and other super-admins share the chairman starter password.
    return CHAIRMAN_PASSWORD;
  }
  if (teacherInitial) return teacherInitialPassword(teacherInitial);
  return teacherInitialPassword(u);
}
