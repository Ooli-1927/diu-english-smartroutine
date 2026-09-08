/**
 * Resolve smoke-test login credentials from environment variables,
 * with department initial-password defaults when unset.
 */
export function requireSmokeCredentials() {
  const adminUser = process.env.SEED_ADMIN_USERNAME || 'Chairman';
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'Chairman123';
  const teacherUser = process.env.SEED_TEACHER_USERNAME || 'LS';
  const teacherPass = process.env.SEED_TEACHER_PASSWORD || 'LS123';
  const teacher2User = process.env.SEED_TEACHER2_USERNAME || 'EHE';
  const teacher2Pass = process.env.SEED_TEACHER2_PASSWORD || 'EHE123';
  const studentUser = process.env.SEED_STUDENT_USERNAME || 'student01@diu.demo';
  const studentPass = process.env.SEED_STUDENT_PASSWORD || '12345678';

  return {
    adminUser,
    adminPass,
    teacherUser,
    teacherPass,
    teacher2User,
    teacher2Pass,
    studentUser,
    studentPass,
  };
}
