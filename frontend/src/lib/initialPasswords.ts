/** Mirrors backend/src/initialPasswords.js for offline/local mode. */

export const CHAIRMAN_USERNAME = 'Chairman';
export const CHAIRMAN_PASSWORD = 'Chairman123';
export const STUDENT_INITIAL_PASSWORD = '12345678';

export function teacherInitialPassword(initial: string): string {
  return `${String(initial || '').trim().toUpperCase()}123`;
}

export function normalizeAdminUsername(username: string): string {
  if (String(username || '').trim().toLowerCase() === 'chairman') {
    return CHAIRMAN_USERNAME;
  }
  return String(username || '').trim();
}

export function adminInitialPassword(
  username: string,
  type: string,
  teacherInitial?: string | null,
): string {
  const u = normalizeAdminUsername(username);
  if (u.toLowerCase() === 'chairman' || type === 'super_admin') {
    return CHAIRMAN_PASSWORD;
  }
  if (teacherInitial) return teacherInitialPassword(teacherInitial);
  return teacherInitialPassword(u);
}
