import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  IdCard,
  LogOut,
  Mail,
  ScanLine,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useNotifications } from '../../hooks/useNotifications';
import { ThemeToggle } from '../../components/ThemeToggle';
import { PushNotificationToggle } from '../../components/PushNotificationToggle';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { GoogleCalendarPanel } from '../../components/GoogleCalendarPanel';
import { InstallAppButton } from '../../components/InstallAppButton';
import { todayDay } from '../../lib/constants';

export function StudentProfilePage() {
  const { session, logout, updateSession } = useAuth();
  const { changePassword, batchById, store, updateOwnProfilePic } = useData();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  const batch = batchById(session?.batchId || '');
  const student = store?.students.find((s) => s.id === session?.id);
  const photo = session?.profilePic || student?.profile_pic || null;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const stats = useMemo(() => {
    const mine = (store?.timetable || []).filter(
      (e) => {
        if (e.batch_id !== session?.batchId || e.is_cancelled) return false;
        const sec = session?.section;
        if (!sec) return true;
        const entrySec = e.section || e.group_name;
        return !entrySec || entrySec === sec;
      },
    );
    const today = mine.filter((e) => e.day === todayDay()).length;
    return {
      week: mine.length,
      today,
      courses: new Set(mine.map((e) => e.course_code)).size,
    };
  }, [store, session?.batchId]);

  async function savePhoto(dataUrl: string | null) {
    if (!session) return;
    const saved = await updateOwnProfilePic(
      { role: session.role, id: session.id },
      dataUrl,
    );
    updateSession({ profilePic: saved });
    setMsg(dataUrl ? 'Profile photo updated' : 'Profile photo removed');
  }

  async function onChangePw(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (next !== confirm) {
      setErr('Passwords do not match');
      return;
    }
    if (!session) return;
    setLoading(true);
    try {
      await changePassword('student', session.id, current, next);
      setMsg('Password updated');
      setOpen(false);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  function doLogout() {
    if (!window.confirm('Are you sure you want to logout?')) return;
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="page profile-stage">
      <span className="brand-kicker">Your profile</span>

      <section className="profile-banner">
        <div className="profile-banner-inner profile-banner-inner--photo-right">
          <div className="profile-banner__copy">
            <h2>{session?.name}</h2>
            <p>{session?.email}</p>
            <div className="profile-chips">
              <span className="profile-chip">
                <IdCard size={14} /> {session?.studentId}
              </span>
              {batch && (
                <span className="profile-chip">
                  <Sparkles size={14} /> {batch.name}
                  {batch.session ? ` · ${batch.session}` : ''}
                </span>
              )}
              <span className="profile-chip">
                <Mail size={14} /> Student portal
              </span>
            </div>
          </div>
          <ProfileAvatar
            src={photo}
            name={session?.name || 'S'}
            size="xxl"
            editable
            onChange={savePhoto}
          />
        </div>
      </section>

      <section className="card pad profile-prefs">
        <div className="field-label">Preferences</div>
        <div className="profile-prefs__row">
          <div className="profile-prefs__item">
            <span className="muted">Appearance</span>
            <ThemeToggle />
          </div>
          <div className="profile-prefs__item">
            <span className="muted">Push alerts</span>
            <div className="row-gap">
              <PushNotificationToggle />
              <span className="muted small">Tap the bell to turn on</span>
            </div>
          </div>
          <div className="profile-prefs__links">
            <Link to="/student/notifications" className="btn-outline profile-prefs__notices">
              <Bell size={16} />
              Notices
              {unread > 0 ? <span className="nav-badge">{unread > 9 ? '9+' : unread}</span> : null}
            </Link>
            <Link to="/student/appointments" className="btn-outline profile-prefs__notices">
              <CalendarCheck size={16} />
              Appointments
            </Link>
            <Link to="/student/attendance" className="btn-outline profile-prefs__notices">
              <ScanLine size={16} />
              Attendance
            </Link>
          </div>
        </div>
      </section>

      <div className="profile-stat-row">
        <div className="profile-stat">
          <strong>{stats.today}</strong>
          <span>Classes today</span>
        </div>
        <div className="profile-stat" style={{ animationDelay: '60ms' }}>
          <strong>{stats.week}</strong>
          <span>Weekly classes</span>
        </div>
        <div className="profile-stat" style={{ animationDelay: '120ms' }}>
          <strong>{stats.courses}</strong>
          <span>Active courses</span>
        </div>
      </div>

      <div className="profile-grid">
        <section className="profile-panel">
          <h3>
            <BookOpen size={16} style={{ marginRight: 8 }} /> Academic profile
          </h3>
          <div className="info-row">
            <span className="muted">Full name</span>
            <strong>{session?.name || '—'}</strong>
          </div>
          <div className="info-row">
            <span className="muted">Student ID</span>
            <strong>{session?.studentId || '—'}</strong>
          </div>
          <div className="info-row">
            <span className="muted">Email</span>
            <strong>{session?.email || '—'}</strong>
          </div>
          <div className="info-row">
            <span className="muted">Batch</span>
            <strong>
              {batch?.name || session?.batchId || '—'}
              {session?.section ? ` · Sec ${session.section}` : ''}
            </strong>
          </div>
          <div className="info-row">
            <span className="muted">Session</span>
            <strong>{batch?.session || '—'}</strong>
          </div>
        </section>

        <section className="profile-panel">
          <div className="row-between">
            <h3>
              <Shield size={16} style={{ marginRight: 8 }} /> Security
            </h3>
            {!student?.has_changed_password && (
              <button className="link-btn" onClick={() => setOpen((o) => !o)}>
                {open ? 'Close' : 'Change'}
              </button>
            )}
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {student?.has_changed_password
              ? 'You already changed your password once. If you forget it, ask the Chairman to reset it.'
              : 'You may change the department password once. Upload your photo from the camera button on your avatar. Chairman can reset your password if you forget it.'}
          </p>
          {open && !student?.has_changed_password && (
            <form className="stack" onSubmit={onChangePw}>
              <input
                className="input"
                type="password"
                placeholder="Current password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
              <input
                className="input"
                type="password"
                placeholder="New password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
              <input
                className="input"
                type="password"
                placeholder="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {err && <div className="error-banner">{err}</div>}
              {msg && <div className="success-banner">{msg}</div>}
              <div className="row-2">
                <button type="button" className="btn-outline" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={loading}>
                  Update
                </button>
              </div>
            </form>
          )}
          {!open && msg && <div className="success-banner">{msg}</div>}
          <div className="profile-actions">
            <InstallAppButton />
            <button className="btn-outline" onClick={() => navigate('/student')}>
              <CalendarDays size={16} /> My schedule
            </button>
            <button className="btn-danger" onClick={doLogout}>
              <LogOut size={16} /> Logout
            </button>
          </div>
        </section>

        <GoogleCalendarPanel />
      </div>
    </div>
  );
}
