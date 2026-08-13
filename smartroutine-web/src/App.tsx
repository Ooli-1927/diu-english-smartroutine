import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useData } from './context/DataContext';
import { portalPath } from './lib/store';
import { OfflineBanner } from './components/OfflineBanner';
import { AppToast } from './components/AppToast';
import { LoginPage } from './pages/LoginPage';
import { StudentLayout } from './pages/student/StudentLayout';
import { StudentSchedulePage } from './pages/student/StudentSchedulePage';
import { TeacherLookupPage } from './pages/student/TeacherLookupPage';
import { RoomSearchPage } from './pages/student/RoomSearchPage';
import { FreeRoomsPage } from './pages/student/FreeRoomsPage';
import { StudentProfilePage } from './pages/student/StudentProfilePage';
import { StudentNotificationsPage } from './pages/student/StudentNotificationsPage';
import { StudentAppointmentsPage } from './pages/student/StudentAppointmentsPage';
import { TeacherPortalPage } from './pages/teacher/TeacherPortalPage';
import { TeacherLayout } from './pages/teacher/TeacherLayout';
import { TeacherProfilePage } from './pages/teacher/TeacherProfilePage';
import { TeacherNotificationsPage } from './pages/teacher/TeacherNotificationsPage';
import { TeacherAppointmentsPage } from './pages/teacher/TeacherAppointmentsPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminBatchesPage } from './pages/admin/AdminBatchesPage';
import { AdminStudentsPage } from './pages/admin/AdminStudentsPage';
import { AdminTeachersPage } from './pages/admin/AdminTeachersPage';
import { AdminCoursesPage } from './pages/admin/AdminCoursesPage';
import { AdminRoomsPage } from './pages/admin/AdminRoomsPage';
import { AdminTimetablePage } from './pages/admin/AdminTimetablePage';
import { AdminConflictsPage } from './pages/admin/AdminConflictsPage';
import { AdminGeneratePage } from './pages/admin/AdminGeneratePage';
import { AdminNoticesPage } from './pages/admin/AdminNoticesPage';
import { AdminAnalyticsPage } from './pages/admin/AdminAnalyticsPage';
import { AdminProfilePage } from './pages/admin/AdminProfilePage';
import { AdminLabPage } from './pages/admin/AdminLabPage';
import { StudentOptimizerPage } from './pages/student/StudentOptimizerPage';
import { StudentAttendancePage } from './pages/student/StudentAttendancePage';
import type { UserRole } from './lib/types';
import { BrandMark } from './components/BrandMark';

function RequireAuth({
  roles,
  children,
}: {
  roles: UserRole[];
  children: ReactNode;
}) {
  const { session, loading } = useAuth();
  const { store, mode } = useData();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  if (!roles.includes(session.role)) {
    return <Navigate to={portalPath(session.role)} replace />;
  }
  if (mode === 'api' && !store) return <Splash />;
  return <>{children}</>;
}

function Splash() {
  return (
    <div className="splash">
      <BrandMark
        variant="splash"
        title="SmartRoutine"
        subtitle="Department of English · Daffodil International University"
      />
      <p className="splash-loading">Loading campus schedule…</p>
    </div>
  );
}

function HomeRedirect() {
  const { session, loading } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={portalPath(session.role)} replace />;
}

export default function App() {
  const { ready, error } = useData();
  if (!ready) return <Splash />;
  if (error) {
    return (
      <div className="splash">
        <p className="error-banner">{error}</p>
      </div>
    );
  }

  return (
    <>
      <OfflineBanner />
      <AppToast />
      <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/student"
        element={
          <RequireAuth roles={['student']}>
            <StudentLayout />
          </RequireAuth>
        }
      >
        <Route index element={<StudentSchedulePage />} />
        <Route path="teacher" element={<TeacherLookupPage />} />
        <Route path="room" element={<RoomSearchPage />} />
        <Route path="free" element={<FreeRoomsPage />} />
        <Route path="optimize" element={<StudentOptimizerPage />} />
        <Route path="attendance" element={<StudentAttendancePage />} />
        <Route path="notifications" element={<StudentNotificationsPage />} />
        <Route path="appointments" element={<StudentAppointmentsPage />} />
        <Route path="profile" element={<StudentProfilePage />} />
      </Route>

      <Route
        path="/teacher"
        element={
          <RequireAuth roles={['teacher', 'teacher_admin']}>
            <TeacherLayout />
          </RequireAuth>
        }
      >
        <Route index element={<TeacherPortalPage />} />
        <Route path="profile" element={<TeacherProfilePage />} />
        <Route path="notifications" element={<TeacherNotificationsPage />} />
        <Route path="appointments" element={<TeacherAppointmentsPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireAuth roles={['super_admin']}>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="batches" element={<AdminBatchesPage />} />
        <Route path="students" element={<AdminStudentsPage />} />
        <Route path="teachers" element={<AdminTeachersPage />} />
        <Route path="courses" element={<AdminCoursesPage />} />
        <Route path="rooms" element={<AdminRoomsPage />} />
        <Route path="timetable" element={<AdminTimetablePage />} />
        <Route path="conflicts" element={<AdminConflictsPage />} />
        <Route path="generate" element={<AdminGeneratePage />} />
        <Route path="lab" element={<AdminLabPage />} />
        <Route path="notices" element={<AdminNoticesPage />} />
        <Route path="analytics" element={<AdminAnalyticsPage />} />
        <Route path="profile" element={<AdminProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
