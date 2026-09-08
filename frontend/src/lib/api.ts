import type {
  AppNotification,
  Appointment,
  AppointmentSlot,
  AppointmentStatus,
  AppointmentWindow,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TRANSIENT_HTTP = new Set([408, 429, 502, 503, 504]);

async function request<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
  attempt = 0,
): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    if (path !== '/auth/login' && attempt < 6) {
      await sleep(350 * 2 ** Math.min(attempt, 4));
      return request<T>(path, { method, body }, attempt + 1);
    }
    throw new ApiError('Live server is restarting — wait a moment and try again', 503);
  }

  if (TRANSIENT_HTTP.has(res.status) && path !== '/auth/login' && attempt < 6) {
    await sleep(350 * 2 ** Math.min(attempt, 4));
    return request<T>(path, { method, body }, attempt + 1);
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const payload = data as { error?: string; conflicts?: ApiConflict[] } | null;
    const isLoginAttempt = path === '/auth/login';
    if (res.status === 401 && !isLoginAttempt) {
      clearToken();
      emitAuthRequired();
    }
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

/** Retry briefly so a restarting API is not treated as offline/demo mode. */
export async function isApiReachable(): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await fetch(`${BASE}/health`, {
        signal: AbortSignal.timeout(900),
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        if (data.status === 'ok') return true;
      }
    } catch {
      /* API still booting or proxy blip */
    }
    if (attempt < 7) await sleep(300);
  }
  return false;
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
  bulkDeleteEntries: (ids: string[]) =>
    request<{ ok: true; deleted: number }>('/timetable/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),
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
    slot_id?: string;
  }) => request<Appointment>('/appointments', { method: 'POST', body }),
  respondToAppointment: (
    id: string,
    body: { status: AppointmentStatus | 'declined'; teacher_remarks?: string },
  ) => request<Appointment>(`/appointments/${id}`, { method: 'PATCH', body }),
  appointmentSlots: (teacherInitial?: string) => {
    const q = teacherInitial ? `?teacher_initial=${encodeURIComponent(teacherInitial)}` : '';
    return request<{
      teacher_initial: string | null;
      slots: AppointmentSlot[];
      windows: AppointmentWindow[];
    }>(`/appointment-slots${q}`);
  },
  createAppointmentSlot: (body: {
    day: DayCode;
    start_time: string;
    end_time: string;
    location?: string;
    note?: string;
    is_active?: boolean;
    teacher_initial?: string;
  }) => request<AppointmentSlot>('/appointment-slots', { method: 'POST', body }),
  updateAppointmentSlot: (
    id: string,
    body: Partial<{
      day: DayCode;
      start_time: string;
      end_time: string;
      location: string;
      note: string;
      is_active: boolean;
    }>,
  ) => request<AppointmentSlot>(`/appointment-slots/${id}`, { method: 'PATCH', body }),
  deleteAppointmentSlot: (id: string) =>
    request<{ ok: true }>(`/appointment-slots/${id}`, { method: 'DELETE' }),

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
