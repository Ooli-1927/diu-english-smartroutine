import type {
  Admin,
  AppData,
  AuthSession,
  Batch,
  Course,
  Room,
  Student,
  Teacher,
  TimetableEntry,
  UserRole,
} from './types';
import { LOCAL_DATA_KEY, uid } from './constants';
import { isSupabaseConfigured, supabase } from './supabase';
import {
  CHAIRMAN_PASSWORD,
  CHAIRMAN_USERNAME,
  STUDENT_INITIAL_PASSWORD,
  adminInitialPassword,
  normalizeAdminUsername,
  teacherInitialPassword,
} from './initialPasswords';

interface RawJson {
  teachers: Array<Partial<Teacher> & { initial: string; name: string; designation: string; home_department: string }>;
  batches: Array<{ id: string; name: string; session: string }>;
  courses: Array<{ code: string; title: string }>;
  rooms: Array<{ id?: string; name: string }>;
  students: Array<Partial<Student>>;
  timetable: Array<{
    day: TimetableEntry['day'];
    batch_id: string;
    teacher_initial: string;
    course_code: string;
    type: TimetableEntry['type'];
    group?: string | null;
    room_id?: string | null;
    mode: TimetableEntry['mode'];
    start: string;
    end: string;
    is_cancelled?: boolean;
    cancellation_reason?: string | null;
  }>;
  admins: Array<{
    id: string;
    username: string;
    password: string;
    type: 'super_admin' | 'teacher_admin';
    teacher_initial: string | null;
  }>;
}

export interface StoreState extends AppData {
  admins: Admin[];
  source: 'supabase' | 'local' | 'api';
}

/** Full offline store with demo passwords — not exposed via React context. */
let storeVault: StoreState | null = null;
let offlineCredsLogged = false;

function logOfflineCredentialsOnce(state: StoreState) {
  if (offlineCredsLogged || state.source !== 'local') return;
  offlineCredsLogged = true;

  console.info('=== Offline demo credentials (department initial passwords) ===');
  console.info(`chairman: ${CHAIRMAN_USERNAME} / ${CHAIRMAN_PASSWORD}`);
  console.info('teacher:  <INITIAL> / <INITIAL>123  (e.g. ZTF / ZTF123)');
  console.info(`student:  <email> / ${STUDENT_INITIAL_PASSWORD}`);
  console.info(
    `Accounts in this browser: ${state.admins.length} admins, ${state.teachers.length} teachers, ${state.students.length} students`,
  );
  console.info('=== End offline demo credentials ===');
}

export function getStoreVault(): StoreState | null {
  return storeVault;
}

/** Strip credential fields before putting data in client context / UI. */
export function sanitizeStoreForClient(state: StoreState): StoreState {
  return {
    ...state,
    teachers: state.teachers.map((t) => ({ ...t, password: null })),
    students: state.students.map((s) => ({ ...s, password: null })),
    admins: state.admins.map((a) => ({ ...a, password_hash: '' })),
  };
}

/**
 * Mirror API bootstrap scoping: only super_admin sees the full student list;
 * students see themselves; teachers see none. Always sanitize credentials.
 */
export function scopeStoreForSession(
  state: StoreState,
  session: AuthSession | null,
): StoreState {
  const clean = sanitizeStoreForClient(state);
  if (!session) {
    return { ...clean, students: [], admins: [] };
  }
  if (session.role === 'super_admin') {
    return clean;
  }
  if (session.role === 'student') {
    return {
      ...clean,
      students: clean.students.filter((s) => s.id === session.id),
      admins: [],
    };
  }
  return { ...clean, students: [], admins: [] };
}

/** Re-check a restored offline session still maps to a seeded user. */
export function sessionMatchesStore(
  state: StoreState,
  session: AuthSession,
): boolean {
  if (session.role === 'super_admin') {
    return state.admins.some(
      (a) => a.id === session.id && a.type === 'super_admin',
    );
  }
  if (session.role === 'teacher_admin') {
    const adminOk = state.admins.some(
      (a) =>
        a.type === 'teacher_admin' &&
        (a.id === session.id ||
          (session.teacherInitial && a.teacher_initial === session.teacherInitial)),
    );
    const teacherOk = state.teachers.some(
      (t) =>
        t.id === session.id ||
        (session.teacherInitial && t.initial === session.teacherInitial),
    );
    return adminOk || teacherOk;
  }
  if (session.role === 'teacher') {
    return state.teachers.some(
      (t) =>
        t.id === session.id ||
        (session.teacherInitial && t.initial === session.teacherInitial),
    );
  }
  if (session.role === 'student') {
    return state.students.some((s) => s.id === session.id);
  }
  return false;
}

/** API mode keeps credentials server-side, so the admin list stays empty here. */
export function storeFromBootstrap(payload: {
  teachers: Teacher[];
  batches: Batch[];
  courses: Course[];
  rooms: Room[];
  students: Student[];
  timetable: TimetableEntry[];
}): StoreState {
  return {
    teachers: payload.teachers,
    batches: payload.batches,
    courses: payload.courses,
    rooms: payload.rooms,
    students: payload.students,
    timetable: payload.timetable,
    admins: [],
    source: 'api',
  };
}

function normalizeFromJson(raw: RawJson): StoreState {
  const teachers: Teacher[] = raw.teachers.map((t, i) => {
    const initial = String(t.initial).toUpperCase();
    return {
      id: t.id || `T${String(i + 1).padStart(3, '0')}`,
      name: t.name,
      initial,
      designation: t.designation,
      phone: t.phone ?? null,
      email: t.email ?? null,
      home_department: t.home_department,
      profile_pic: t.profile_pic ?? null,
      password: teacherInitialPassword(initial),
      has_changed_password: t.has_changed_password ?? false,
    };
  });

  const batches: Batch[] = raw.batches.map((b) => ({
    id: b.id,
    name: b.name,
    session: b.session,
  }));

  const courses: Course[] = raw.courses.map((c, i) => ({
    id: `C${i + 1}`,
    code: c.code,
    title: c.title,
  }));

  const rooms: Room[] = raw.rooms.map((r) => ({
    id: r.id || r.name,
    name: r.name || r.id || '',
  }));

  let students: Student[] = (raw.students || []).map((s, i) => ({
    id: s.id || `S${i + 1}`,
    student_id: s.student_id || `STU${i + 1}`,
    name: s.name || 'Student',
    batch_id: s.batch_id || batches[0]?.id || '',
    section: (s as { section?: string | null }).section ?? null,
    email: s.email ?? null,
    phone: s.phone ?? null,
    profile_pic: (s as Student).profile_pic ?? null,
    password: STUDENT_INITIAL_PASSWORD,
    has_changed_password: s.has_changed_password ?? false,
  }));

  if (students.length === 0 && batches.length) {
    students = batches.slice(0, 3).flatMap((b, bi) =>
      [1, 2].map((n) => ({
        id: uid('stu'),
        student_id: `21020${bi}${n}`,
        name: `Demo Student ${b.name} #${n}`,
        batch_id: b.id,
        section: 'A',
        email: `student${bi}${n}@diu.demo`,
        phone: null,
        profile_pic: null,
        password: STUDENT_INITIAL_PASSWORD,
        has_changed_password: false,
      })),
    );
  }

  const roomByName = new Map(rooms.map((r) => [r.name, r.id]));
  const timetable: TimetableEntry[] = raw.timetable.map((e, i) => {
    const section =
      (e as { section?: string | null }).section ??
      (e as { group?: string | null }).group ??
      null;
    return {
      id: uid(`tt${i}`),
      day: e.day,
      batch_id: e.batch_id,
      teacher_initial: e.teacher_initial,
      course_code: e.course_code,
      type: e.type,
      section,
      group_name: section,
      room_id: e.room_id
        ? roomByName.get(e.room_id) || e.room_id
        : null,
      mode: e.mode,
      start_time: e.start,
      end_time: e.end,
      is_cancelled: e.is_cancelled ?? false,
      cancellation_reason: e.cancellation_reason ?? null,
    };
  });

  const admins: Admin[] = (raw.admins || []).map((a) => {
    const username = normalizeAdminUsername(a.username);
    const type = a.type;
    return {
      id: a.id,
      username,
      password_hash: adminInitialPassword(username, type, a.teacher_initial),
      type,
      teacher_initial: a.teacher_initial,
    };
  });

  const ensureAdmin = (
    username: string,
    id: string,
    type: 'super_admin' | 'teacher_admin' = 'super_admin',
  ) => {
    if (admins.find((a) => a.username.toLowerCase() === username.toLowerCase())) return;
    admins.push({
      id,
      username,
      password_hash: CHAIRMAN_PASSWORD,
      type,
      teacher_initial: null,
    });
  };
  ensureAdmin(CHAIRMAN_USERNAME, 'A_CHAIR');
  ensureAdmin('superadmin@diu.demo', 'A_SUPER');
  ensureAdmin('admin@diu.demo', 'A_ADMIN');

  const state: StoreState = {
    teachers,
    batches,
    courses,
    rooms,
    students,
    timetable,
    admins,
    source: 'local',
  };

  offlineCredsLogged = false;
  logOfflineCredentialsOnce(state);
  return state;
}

async function loadFromSupabase(): Promise<StoreState | null> {
  if (!supabase) return null;
  try {
    const [
      teachersRes,
      batchesRes,
      coursesRes,
      roomsRes,
      studentsRes,
      timetableRes,
      adminsRes,
    ] = await Promise.all([
      supabase.from('teachers').select('*'),
      supabase.from('batches').select('*'),
      supabase.from('courses').select('*'),
      supabase.from('rooms').select('*'),
      supabase.from('students').select('*'),
      supabase.from('timetable_entries').select('*'),
      supabase.from('admins').select('*'),
    ]);

    if (teachersRes.error) throw teachersRes.error;

    return {
      teachers: (teachersRes.data || []) as Teacher[],
      batches: (batchesRes.data || []) as Batch[],
      courses: (coursesRes.data || []) as Course[],
      rooms: (roomsRes.data || []) as Room[],
      students: (studentsRes.data || []) as Student[],
      timetable: (timetableRes.data || []).map((e: Record<string, unknown>) => ({
        ...e,
        start_time: String(e.start_time).slice(0, 5),
        end_time: String(e.end_time).slice(0, 5),
      })) as TimetableEntry[],
      admins: (adminsRes.data || []) as Admin[],
      source: 'supabase',
    };
  } catch (err) {
    console.warn('Supabase load failed, falling back to local JSON', err);
    return null;
  }
}

export async function loadStore(): Promise<StoreState> {
  const cached = localStorage.getItem(LOCAL_DATA_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as StoreState;
      if (parsed.teachers?.length) {
        const state = { ...parsed, source: parsed.source || 'local' } as StoreState;
        storeVault = state;
        logOfflineCredentialsOnce(state);
        return state;
      }
    } catch {
      /* ignore */
    }
  }

  if (isSupabaseConfigured) {
    const remote = await loadFromSupabase();
    if (remote && remote.teachers.length) {
      persistStore(remote);
      storeVault = remote;
      return remote;
    }
  }

  const res = await fetch('/data/data.json');
  const raw = (await res.json()) as RawJson;
  const state = normalizeFromJson(raw);
  persistStore(state);
  storeVault = state;
  return state;
}

export function persistStore(state: StoreState) {
  storeVault = state;
  localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(state));
}


export function loginWithStore(
  state: StoreState,
  usernameOrEmail: string,
  password: string,
): AuthSession | null {
  const u = usernameOrEmail.trim();
  const p = password;

  const admin = state.admins.find(
    (a) => a.username.toLowerCase() === u.toLowerCase() && a.password_hash === p,
  );
  if (admin) {
    if (admin.type === 'super_admin') {
      return {
        role: 'super_admin',
        id: admin.id,
        name: 'Super Admin',
        username: admin.username,
        profilePic: admin.profile_pic ?? null,
      };
    }
    const teacher = state.teachers.find((t) => t.initial === admin.teacher_initial);
    return {
      role: 'teacher_admin',
      id: teacher?.id || admin.id,
      name: teacher?.name || admin.username,
      username: admin.username,
      teacherInitial: admin.teacher_initial,
      email: teacher?.email,
      profilePic: teacher?.profile_pic ?? null,
    };
  }

  const teacher = state.teachers.find(
    (t) =>
      ((t.email && t.email.toLowerCase() === u.toLowerCase()) ||
        t.initial.toLowerCase() === u.toLowerCase()) &&
      Boolean(t.password) &&
      t.password === p,
  );
  if (teacher) {
    return {
      role: 'teacher',
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      teacherInitial: teacher.initial,
      profilePic: teacher.profile_pic ?? null,
    };
  }

  const student = state.students.find(
    (s) =>
      ((s.email && s.email.toLowerCase() === u.toLowerCase()) ||
        s.student_id.toLowerCase() === u.toLowerCase()) &&
      s.password === p,
  );
  if (student) {
    return {
      role: 'student',
      id: student.id,
      name: student.name,
      email: student.email,
      studentId: student.student_id,
      batchId: student.batch_id,
      section: student.section || null,
      profilePic: student.profile_pic ?? null,
    };
  }

  return null;
}

export function portalPath(role: UserRole): string {
  if (role === 'super_admin') return '/admin';
  if (role === 'teacher' || role === 'teacher_admin') return '/teacher';
  return '/student';
}
