import type {
  AppNotification,
  Appointment,
  AppointmentStatus,
  AuthSession,
  Batch,
  Course,
  DayCode,
  GenerateResult,
  Room,
  RoutineRequirement,
  Student,
  Teacher,
  TimetableEntry,
} from './types';

const TOKEN_KEY = 'diu_api_token';
const BASE = import.meta.env.VITE_API_URL || '/api';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiConflict {
  kind: 'room' | 'teacher' | 'batch';
  resource: string;
  message: string;
  with: TimetableEntry;
}

export class ApiError extends Error {
  status: number;

  conflicts: ApiConflict[];

  constructor(message: string, status: number, conflicts: ApiConflict[] = []) {
    super(message);
    this.status = status;
    this.conflicts = conflicts;
  }
}

/** Fired when the API rejects a request as unauthenticated so the UI can force re-login. */
export const AUTH_REQUIRED_EVENT = 'diu-english:auth-required';

function emitAuthRequired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
  }
}

async function request<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const payload = data as { error?: string; conflicts?: ApiConflict[] } | null;
    const isLoginAttempt = path === '/auth/login';
    if (res.status === 401 && !isLoginAttempt) {
      clearToken();
      emitAuthRequired();
    }
    // Prefer server message (e.g. invalid credentials). Only fall back to
    // "session expired" for authenticated routes that rejected a token.
    const message =
      payload?.error ||
      (res.status === 401 && !isLoginAttempt
        ? 'Session expired — please log in again'
        : `Request failed (${res.status})`);
    throw new ApiError(message, res.status, payload?.conflicts || []);
  }
  return data as T;
}

export interface BootstrapPayload {
  source: 'api';
  meta: Record<string, unknown> | null;
  teachers: Teacher[];
  batches: Batch[];
  courses: Course[];
  rooms: Room[];
  students: Student[];
  timetable: TimetableEntry[];
}

/** Short timeout so the UI falls back to offline mode instead of hanging. */
export async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

export const api = {
  async login(username: string, password: string) {
    const data = await request<{ token: string; session: AuthSession }>('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    setToken(data.token);
    return data.session;
  },

  me: () => request<{ session: AuthSession }>('/auth/me'),

  updateProfilePic: (profile_pic: string | null) =>
    request<{ session: AuthSession }>('/auth/me/profile-pic', {
      method: 'PUT',
      body: { profile_pic },
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  bootstrap: () => request<BootstrapPayload>('/bootstrap'),

  createBatch: (body: Partial<Batch>) => request<Batch>('/batches', { method: 'POST', body }),
  updateBatch: (id: string, body: Partial<Batch>) =>
    request<Batch>(`/batches/${id}`, { method: 'PUT', body }),
  deleteBatch: (id: string) => request<{ ok: true }>(`/batches/${id}`, { method: 'DELETE' }),

  createCourse: (body: Partial<Course>) => request<Course>('/courses', { method: 'POST', body }),
  updateCourse: (id: string, body: Partial<Course>) =>
    request<Course>(`/courses/${id}`, { method: 'PUT', body }),
  deleteCourse: (id: string) => request<{ ok: true }>(`/courses/${id}`, { method: 'DELETE' }),

  createRoom: (body: Partial<Room>) => request<Room>('/rooms', { method: 'POST', body }),
  updateRoom: (id: string, body: Partial<Room>) =>
    request<Room>(`/rooms/${id}`, { method: 'PUT', body }),
  deleteRoom: (id: string) => request<{ ok: true }>(`/rooms/${id}`, { method: 'DELETE' }),

  createTeacher: (body: Partial<Teacher> & { password?: string }) =>
    request<Teacher>('/teachers', { method: 'POST', body }),
  updateTeacher: (id: string, body: Partial<Teacher> & { password?: string }) =>
    request<Teacher>(`/teachers/${id}`, { method: 'PUT', body }),
  deleteTeacher: (id: string) => request<{ ok: true }>(`/teachers/${id}`, { method: 'DELETE' }),

  createStudent: (body: Partial<Student> & { password?: string }) =>
    request<Student>('/students', { method: 'POST', body }),
  updateStudent: (id: string, body: Partial<Student> & { password?: string }) =>
    request<Student>(`/students/${id}`, { method: 'PUT', body }),
  deleteStudent: (id: string) => request<{ ok: true }>(`/students/${id}`, { method: 'DELETE' }),

  createEntry: (body: Omit<TimetableEntry, 'id'> & { force?: boolean }) =>
    request<TimetableEntry>('/timetable', { method: 'POST', body }),
  patchEntry: (id: string, body: Partial<TimetableEntry> & { force?: boolean }) =>
    request<TimetableEntry>(`/timetable/${id}`, { method: 'PATCH', body }),
  deleteEntry: (id: string) => request<{ ok: true }>(`/timetable/${id}`, { method: 'DELETE' }),
  importEntries: (entries: Omit<TimetableEntry, 'id'>[], replace: boolean) =>
    request<{ imported: number; rejected: Array<{ row: number; errors: string[] }> }>(
      '/timetable/import',
      { method: 'POST', body: { entries, replace } },
    ),

  timetableConflicts: () =>
    request<{
      summary: { total: number; room: number; teacher: number; batch: number };
      conflicts: Array<{
        kind: 'room' | 'teacher' | 'batch';
        day: DayCode;
        start_time: string;
        end_time: string;
        resource: string;
        message: string;
        entries: TimetableEntry[];
      }>;
    }>('/timetable/conflicts'),

  timetableSlots: () =>
    request<{ days: DayCode[]; slots: Array<{ start: string; end: string }> }>('/timetable/slots'),
  timetableRequirements: (batchIds: string[] = []) =>
    request<RoutineRequirement[]>(
      `/timetable/requirements${batchIds.length ? `?batch_ids=${batchIds.join(',')}` : ''}`,
    ),
  generateTimetable: (body: {
    requirements: RoutineRequirement[];
    days?: DayCode[];
    slots?: Array<{ start: string; end: string }>;
    replace?: boolean;
    dryRun?: boolean;
    maxPerBatchPerDay?: number;
    maxPerTeacherPerDay?: number;
    soft?: {
      preferredDays?: DayCode[];
      avoidDays?: DayCode[];
      preferMorning?: boolean;
      noBackToBack?: boolean;
      maxConsecutive?: number;
    };
  }) => request<GenerateResult>('/timetable/generate', { method: 'POST', body }),

  notifications: () => request<AppNotification[]>('/notifications'),
  markNotificationRead: (id: string) =>
    request<{ ok: true }>(`/notifications/${id}/read`, { method: 'PATCH' }),

  pushVapidPublicKey: () => request<{ publicKey: string; configured: boolean }>('/push/vapid-public-key'),
  pushStatus: () => request<{ configured: boolean }>('/push/status'),
  pushSubscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ ok: true; id: string }>('/push/subscribe', { method: 'POST', body }),
  pushUnsubscribe: (endpoint?: string) =>
    request<{ ok: true }>('/push/subscribe', {
      method: 'DELETE',
      body: endpoint ? { endpoint } : {},
    }),

  googleStatus: () =>
    request<{
      configured: boolean;
      connected: boolean;
      allowed?: boolean;
      email: string | null;
      calendarId?: string | null;
      lastSyncAt: string | null;
      lastSyncError: string | null;
    }>('/google/status'),
  googleAuthUrl: () => request<{ url: string }>('/google/auth-url', { method: 'POST', body: {} }),
  googleSync: () =>
    request<{
      ok: true;
      events?: number;
      status: {
        configured: boolean;
        connected: boolean;
        email: string | null;
        lastSyncAt: string | null;
        lastSyncError: string | null;
      };
    }>('/google/sync', { method: 'POST', body: {} }),
  googleDisconnect: () =>
    request<{
      ok: true;
      status: {
        configured: boolean;
        connected: boolean;
        email: string | null;
        lastSyncAt: string | null;
        lastSyncError: string | null;
      };
    }>('/google/disconnect', { method: 'DELETE', body: {} }),

  appointments: () => request<Appointment[]>('/appointments'),
  requestAppointment: (body: {
    teacher_initial: string;
    date: string;
    time: string;
    purpose?: string;
  }) => request<Appointment>('/appointments', { method: 'POST', body }),
  respondToAppointment: (
    id: string,
    body: { status: AppointmentStatus; teacher_remarks?: string },
  ) => request<Appointment>(`/appointments/${id}`, { method: 'PATCH', body }),

  mailStatus: () =>
    request<{
      configured: boolean;
      professional: boolean;
      mode: string;
      from: string;
      smtpSaved: boolean;
      smtpUser: string | null;
      tip?: string;
      queue: number;
      active: number;
      recent: Array<Record<string, unknown>>;
    }>('/mail/status'),
  saveMailSmtp: (body: {
    user: string;
    pass: string;
    from?: string;
    fromName?: string;
  }) =>
    request<{
      configured: boolean;
      professional: boolean;
      mode: string;
      from: string;
      smtpSaved: boolean;
      tip?: string;
    }>('/mail/smtp', { method: 'PUT', body }),
  clearMailSmtp: () =>
    request<{ configured: boolean; professional: boolean; mode: string }>('/mail/smtp', {
      method: 'DELETE',
    }),
  testMail: (to: string) =>
    request<{
      ok: true;
      messageId: string;
      to: string;
      mode?: string;
      needsConfirm?: boolean;
      note?: string | null;
      professional?: boolean;
    }>('/mail/test', {
      method: 'POST',
      body: { to },
    }),

  /* Advanced lab */
  whatIf: (body: {
    patch?: Record<string, unknown>;
    cancelIds?: string[];
  }) =>
    request<{
      beforeCount: number;
      afterCount: number;
      delta: number;
      suggestion: string;
      ripple: unknown[];
    }>('/simulate/what-if', { method: 'POST', body }),
  liveOccupancy: () =>
    request<{
      day: string;
      now: string;
      rooms: Array<{
        id: string;
        name: string;
        status: string;
        scheduled: {
          course_code: string;
          teacher_initial: string;
          start_time: string;
          end_time: string;
        } | null;
      }>;
    }>('/rooms/occupancy/live'),
  listNegotiations: () => request<Array<Record<string, unknown>>>('/negotiations'),
  createNegotiation: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/negotiations', { method: 'POST', body }),
  respondNegotiation: (id: string, accept: boolean, force = false) =>
    request<Record<string, unknown>>(`/negotiations/${id}/respond`, {
      method: 'POST',
      body: { accept, force },
    }),
  predictive: () =>
    request<{
      burnout: Array<{ teacher: string; load: number; risk: string; advice: string }>;
      hotSlots: Array<{ day: string; hour: number; count: number; pressure: string }>;
      forecast: Array<{ teacher: string; nextWeekLoad: number; trend: string }>;
    }>('/analytics/predictive'),
  semesters: () =>
    request<{
      semesters: Array<{ id: string; label: string; is_active: number; academic_year?: string }>;
      snapshots: Array<{
        id: string;
        label: string;
        entry_count: number;
        created_at: string;
        semester_id: string;
      }>;
    }>('/semesters'),
  createSemester: (body: { label: string; academic_year?: string }) =>
    request<Record<string, unknown>>('/semesters', { method: 'POST', body }),
  snapshotSemester: (id: string, label?: string) =>
    request<Record<string, unknown>>(`/semesters/${id}/snapshot`, {
      method: 'POST',
      body: { label },
    }),
  activateSemester: (id: string) =>
    request<Record<string, unknown>>(`/semesters/${id}/activate`, { method: 'POST', body: {} }),
  restoreSnapshot: (id: string) =>
    request<{ ok: true; restored: number; label: string }>(`/semesters/snapshots/${id}/restore`, {
      method: 'POST',
      body: {},
    }),
  auditLog: (limit = 80) =>
    request<Array<Record<string, unknown>>>(`/audit?limit=${limit}`),
  nlOps: (text: string, execute = false) =>
    request<{
      intent: string;
      confidence?: number;
      plan: unknown;
      result: unknown;
      hint?: string;
    }>('/ops/nl', { method: 'POST', body: { text, execute } }),
  openAttendance: (entryId: string) =>
    request<{ token: string; scanUrl: string; expires_at: string; id: string }>(
      '/attendance/open',
      { method: 'POST', body: { entryId } },
    ),
  scanAttendance: (token: string) =>
    request<{ ok: true; course?: { course_code: string } }>('/attendance/scan', {
      method: 'POST',
      body: { token },
    }),
  attendanceReport: (entryId?: string) =>
    request<Array<Record<string, unknown>>>(
      entryId ? `/attendance/report?entryId=${encodeURIComponent(entryId)}` : '/attendance/report',
    ),
  myPreferences: () =>
    request<{
      student_id?: string;
      avoid_early: number | boolean;
      prefer_gaps: number | boolean;
      max_daily: number;
      prefer_online: number | boolean;
      notes: string | null;
    }>('/students/me/preferences'),
  savePreferences: (body: {
    avoid_early: boolean;
    prefer_gaps: boolean;
    max_daily: number;
    prefer_online: boolean;
    notes?: string;
  }) => request<Record<string, unknown>>('/students/me/preferences', { method: 'PUT', body }),
  optimizeWeek: () =>
    request<{
      score: number;
      tips: Array<{ day: string; kind: string; text: string }>;
      studyBlocks: Array<{
        day: string;
        start_time: string;
        end_time: string;
        minutes: number;
        suggestion: string;
      }>;
      classCount: number;
    }>('/students/me/optimize', { method: 'POST', body: {} }),
};
