-- =============================================================================
-- DIU SmartRoutine — Supabase schema + Row Level Security
-- Path: supabase_schema.sql (repo root)
-- =============================================================================
--
-- Mirrors Express role rules from smartroutine-api (auth.js / requireRole):
--   super_admin | teacher_admin | teacher | student
--
-- REQUIRED JWT custom claims (set via Supabase Auth custom access token hook
-- or app_metadata when issuing sessions):
--   role              text  -- 'super_admin' | 'teacher_admin' | 'teacher' | 'student'
--   user_id           text  -- app user id (admins.id / teachers.id / students.id)
--   teacher_initial   text  -- optional; required for teacher / teacher_admin writes
--   student_id        text  -- optional; students.student_id for appointments
--
-- Claim helpers below also accept nested app_metadata / user_metadata copies.
--
-- IMPORTANT — anon key without Auth:
--   The current frontend store.ts path uses the Supabase anon key WITHOUT
--   supabase.auth.signIn. With these policies, anon has NO access (default deny).
--   Do NOT weaken RLS for open anon reads. Wire Supabase Auth + JWT claims first,
--   or keep using the Express/SQLite API (Render). Live Render is unaffected by
--   this file until you apply it in the Supabase SQL editor.
--
-- API-only tables intentionally omitted (not loaded by frontend Supabase client):
--   audit_events, semesters, timetable_snapshots, conflict_negotiations,
--   attendance_sessions, attendance_records, room_presence, student_preferences, …
-- =============================================================================

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public.app_claim(claim text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() ->> claim,
    auth.jwt() -> 'app_metadata' ->> claim,
    auth.jwt() -> 'user_metadata' ->> claim
  );
$$;

CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT public.app_claim('role');
$$;

CREATE OR REPLACE FUNCTION public.is_authenticated_app()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.app_role() IN ('super_admin', 'teacher_admin', 'teacher', 'student');
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.app_role() = 'super_admin';
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_side()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.app_role() IN ('teacher', 'teacher_admin', 'super_admin');
$$;

-- ---------- tables ----------
CREATE TABLE IF NOT EXISTS public.admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('super_admin', 'teacher_admin')),
  teacher_initial TEXT,
  profile_pic TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initial TEXT UNIQUE NOT NULL,
  designation TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  home_department TEXT NOT NULL,
  profile_pic TEXT,
  password_hash TEXT,
  has_changed_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  session TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name, session)
);

CREATE TABLE IF NOT EXISTS public.courses (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rooms (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS public.students (
  id TEXT PRIMARY KEY,
  student_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  profile_pic TEXT,
  password_hash TEXT,
  has_changed_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.timetable_entries (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL CHECK (day IN ('Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri')),
  batch_id TEXT NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  teacher_initial TEXT NOT NULL REFERENCES public.teachers(initial) ON DELETE CASCADE,
  course_code TEXT NOT NULL REFERENCES public.courses(code) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('Lecture', 'Tutorial', 'Sessional', 'Online')),
  group_name TEXT,
  room_id TEXT REFERENCES public.rooms(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('Onsite', 'Online', 'Offline')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('super_admin', 'student', 'teacher')),
  recipient_id TEXT NOT NULL,
  related_entry_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id TEXT PRIMARY KEY,
  teacher_initial TEXT NOT NULL REFERENCES public.teachers(initial) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  teacher_remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timetable_day ON public.timetable_entries(day);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON public.timetable_entries(teacher_initial);
CREATE INDEX IF NOT EXISTS idx_timetable_batch ON public.timetable_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_teacher ON public.appointments(teacher_initial);
CREATE INDEX IF NOT EXISTS idx_appointments_student ON public.appointments(student_id);

-- ---------- enable RLS (anon denied by default) ----------
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Drop prior policies if re-running this script
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'admins', 'teachers', 'batches', 'courses', 'rooms',
        'students', 'timetable_entries', 'notifications', 'appointments'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ===== admins: super_admin only (no anon; never expose passwords to public) =====
CREATE POLICY admins_select_super
  ON public.admins FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY admins_insert_super
  ON public.admins FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY admins_update_super
  ON public.admins FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY admins_delete_super
  ON public.admins FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ===== batches / courses / rooms: auth SELECT; mutate super_admin =====
CREATE POLICY batches_select_auth
  ON public.batches FOR SELECT TO authenticated
  USING (public.is_authenticated_app());
CREATE POLICY batches_insert_super
  ON public.batches FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());
CREATE POLICY batches_update_super
  ON public.batches FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
CREATE POLICY batches_delete_super
  ON public.batches FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY courses_select_auth
  ON public.courses FOR SELECT TO authenticated
  USING (public.is_authenticated_app());
CREATE POLICY courses_insert_super
  ON public.courses FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());
CREATE POLICY courses_update_super
  ON public.courses FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
CREATE POLICY courses_delete_super
  ON public.courses FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY rooms_select_auth
  ON public.rooms FOR SELECT TO authenticated
  USING (public.is_authenticated_app());
CREATE POLICY rooms_insert_super
  ON public.rooms FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());
CREATE POLICY rooms_update_super
  ON public.rooms FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
CREATE POLICY rooms_delete_super
  ON public.rooms FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ===== teachers: auth SELECT; INSERT/DELETE super_admin; UPDATE admin or self =====
CREATE POLICY teachers_select_auth
  ON public.teachers FOR SELECT TO authenticated
  USING (public.is_authenticated_app());

CREATE POLICY teachers_insert_super
  ON public.teachers FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY teachers_update_admin_or_self
  ON public.teachers FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.app_role() IN ('teacher', 'teacher_admin')
      AND initial = public.app_claim('teacher_initial')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.app_role() IN ('teacher', 'teacher_admin')
      AND initial = public.app_claim('teacher_initial')
    )
  );

CREATE POLICY teachers_delete_super
  ON public.teachers FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ===== students: SELECT admin or self; INSERT/DELETE admin; UPDATE admin or self =====
CREATE POLICY students_select_admin_or_self
  ON public.students FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.app_role() = 'student'
      AND id = public.app_claim('user_id')
    )
  );

CREATE POLICY students_insert_super
  ON public.students FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY students_update_admin_or_self
  ON public.students FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.app_role() = 'student'
      AND id = public.app_claim('user_id')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.app_role() = 'student'
      AND id = public.app_claim('user_id')
    )
  );

CREATE POLICY students_delete_super
  ON public.students FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ===== timetable: auth SELECT; INSERT/DELETE admin; UPDATE admin or owning teacher =====
CREATE POLICY timetable_select_auth
  ON public.timetable_entries FOR SELECT TO authenticated
  USING (public.is_authenticated_app());

CREATE POLICY timetable_insert_super
  ON public.timetable_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY timetable_update_admin_or_owner
  ON public.timetable_entries FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.app_role() IN ('teacher', 'teacher_admin')
      AND teacher_initial = public.app_claim('teacher_initial')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.app_role() IN ('teacher', 'teacher_admin')
      AND teacher_initial = public.app_claim('teacher_initial')
    )
  );

CREATE POLICY timetable_delete_super
  ON public.timetable_entries FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ===== notifications: recipient can read / mark read; insert super_admin =====
CREATE POLICY notifications_select_recipient
  ON public.notifications FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      recipient_type = public.app_role()
      AND recipient_id = public.app_claim('user_id')
    )
    OR (
      recipient_type = 'teacher'
      AND public.app_role() IN ('teacher', 'teacher_admin')
      AND recipient_id = public.app_claim('teacher_initial')
    )
    OR (
      recipient_type = 'student'
      AND public.app_role() = 'student'
      AND (
        recipient_id = public.app_claim('user_id')
        OR recipient_id = public.app_claim('student_id')
        OR recipient_id = (
          SELECT s.batch_id FROM public.students s
          WHERE s.id = public.app_claim('user_id')
          LIMIT 1
        )
      )
    )
  );

CREATE POLICY notifications_update_recipient
  ON public.notifications FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      recipient_type = 'teacher'
      AND public.app_role() IN ('teacher', 'teacher_admin')
      AND recipient_id = public.app_claim('teacher_initial')
    )
    OR (
      recipient_type = 'student'
      AND public.app_role() = 'student'
      AND (
        recipient_id = public.app_claim('user_id')
        OR recipient_id = public.app_claim('student_id')
        OR recipient_id = (
          SELECT s.batch_id FROM public.students s
          WHERE s.id = public.app_claim('user_id')
          LIMIT 1
        )
      )
    )
    OR (
      recipient_type = 'super_admin'
      AND public.is_super_admin()
      AND recipient_id = public.app_claim('user_id')
    )
  )
  WITH CHECK (true);

CREATE POLICY notifications_insert_super
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

-- ===== appointments =====
CREATE POLICY appointments_select_involved
  ON public.appointments FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.app_role() IN ('teacher', 'teacher_admin')
      AND teacher_initial = public.app_claim('teacher_initial')
    )
    OR (
      public.app_role() = 'student'
      AND (
        student_id = public.app_claim('student_id')
        OR student_id = public.app_claim('user_id')
      )
    )
  );

CREATE POLICY appointments_insert_student
  ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (
    public.app_role() = 'student'
    AND (
      student_id = public.app_claim('student_id')
      OR student_id = public.app_claim('user_id')
    )
  );

CREATE POLICY appointments_update_teacher_admin
  ON public.appointments FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.app_role() IN ('teacher', 'teacher_admin')
      AND teacher_initial = public.app_claim('teacher_initial')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.app_role() IN ('teacher', 'teacher_admin')
      AND teacher_initial = public.app_claim('teacher_initial')
    )
  );

-- No GRANT to anon for table data — authenticated only via policies above.
-- Service role bypasses RLS (use only on trusted backends).
