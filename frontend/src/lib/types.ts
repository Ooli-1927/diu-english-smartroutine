export type UserRole = 'super_admin' | 'teacher_admin' | 'teacher' | 'student';

export type DayCode = 'Sat' | 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';

export type ClassType = 'Lecture' | 'Tutorial' | 'Sessional' | 'Online';
export type ClassMode = 'Onsite' | 'Online' | 'Offline';

export interface Admin {
  id: string;
  username: string;
  password_hash: string;
  type: 'super_admin' | 'teacher_admin';
  teacher_initial: string | null;
  profile_pic?: string | null;
}

export interface Teacher {
  id: string;
  name: string;
  initial: string;
  designation: string;
  phone: string | null;
  email: string | null;
  home_department: string;
  profile_pic: string | null;
  password: string | null;
  has_changed_password: boolean;
  notifications_enabled?: boolean;
  email_enabled?: boolean;
}

export interface Batch {
  id: string;
  name: string;
  session: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
}

export interface Room {
  id: string;
  name: string;
}

export interface Student {
  id: string;
  student_id: string;
  name: string;
  batch_id: string;
  section: string | null;
  email: string | null;
  phone: string | null;
  profile_pic: string | null;
  password: string | null;
  has_changed_password: boolean;
}

export interface TimetableEntry {
  id: string;
  day: DayCode;
  batch_id: string;
  teacher_initial: string;
  course_code: string;
  type: ClassType;
  section: string | null;
  group_name: string | null;
  room_id: string | null;
  mode: ClassMode;
  start_time: string;
  end_time: string;
  is_cancelled: boolean;
  cancellation_reason: string | null;
}

export interface RoutineRequirement {
  batch_id: string;
  course_code: string;
  teacher_initial: string;
  type: ClassType;
  mode: ClassMode;
  group_name: string | null;
  sessions_per_week: number;
  room_id?: string | null;
}

export interface UnscheduledRequirement {
  batch_id: string;
  course_code: string;
  teacher_initial: string;
  type: ClassType;
  group_name: string | null;
  session: string;
  reason: string;
}

export interface GenerateResult {
  scheduled: Omit<TimetableEntry, 'id'>[];
  unscheduled: UnscheduledRequirement[];
  stats: {
    requested: number;
    placed: number;
    skipped: number;
    perDay: Record<string, number>;
  };
  applied: boolean;
  replaced: boolean;
  conflicts?: { total: number; room: number; teacher: number; batch: number };
}

export type NotificationType =
  | 'class_cancelled'
  | 'class_restored'
  | 'class_rescheduled'
  | 'class_assigned'
  | 'class_removed'
  | 'room_changed'
  | 'appointment'
  | string;

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  recipient_type: 'super_admin' | 'student' | 'teacher';
  recipient_id: string;
  related_entry_id?: string | null;
  is_read: boolean;
  created_at: string;
}

export type AppointmentStatus = 'pending' | 'accepted' | 'rejected';

export interface AppointmentSlot {
  id: string;
  teacher_initial: string;
  day: DayCode;
  start_time: string;
  end_time: string;
  location: string;
  note: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AppointmentWindow {
  slot_id: string;
  teacher_initial: string;
  date: string;
  day: DayCode;
  start_time: string;
  end_time: string;
  location: string;
  note: string;
}

export interface Appointment {
  id: string;
  teacher_initial: string;
  student_id: string;
  student_name: string;
  date: string;
  time: string;
  purpose: string | null;
  status: AppointmentStatus;
  teacher_remarks: string | null;
  slot_id?: string | null;
  created_at: string;
}

export function appointmentStatusLabel(status: AppointmentStatus | string): string {
  if (status === 'rejected' || status === 'declined') return 'Declined';
  if (status === 'accepted') return 'Accepted';
  return 'Pending';
}

export interface AuthSession {
  role: UserRole;
  id: string;
  name: string;
  email?: string | null;
  username?: string;
  teacherInitial?: string | null;
  studentId?: string;
  batchId?: string | null;
  section?: string | null;
  profilePic?: string | null;
}

export interface AppData {
  teachers: Teacher[];
  batches: Batch[];
  courses: Course[];
  rooms: Room[];
  students: Student[];
  timetable: TimetableEntry[];
}
