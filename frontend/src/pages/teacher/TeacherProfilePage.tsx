import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  Briefcase,
  Mail,
  Phone,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useNotifications } from '../../hooks/useNotifications';
import { PageHero } from '../../components/PageHero';
import { PortalAlerts } from '../../components/PortalAlerts';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { ThemeToggle } from '../../components/ThemeToggle';
import { PushNotificationToggle } from '../../components/PushNotificationToggle';
import { GoogleCalendarPanel } from '../../components/GoogleCalendarPanel';
import { InstallAppButton } from '../../components/InstallAppButton';
import { todayDay } from '../../lib/constants';

export function TeacherProfilePage() {
  const { session, updateSession } = useAuth();
  const { store, teacherByInitial, upsertTeacher, changePassword, updateOwnProfilePic } =
    useData();
  const { unread } = useNotifications();
  const teacher = teacherByInitial(session?.teacherInitial || '');
  const photo = session?.profilePic || teacher?.profile_pic || null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: teacher?.name || '',
    email: teacher?.email || '',
    phone: teacher?.phone || '',
    designation: teacher?.designation || '',
    home_department: teacher?.home_department || '',
  });
  const [pwOpen, setPwOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useMemo(() => {
    const mine = (store?.timetable || []).filter(
      (e) => e.teacher_initial === teacher?.initial && !e.is_cancelled,
    );
    return {
      week: mine.length,
      today: mine.filter((e) => e.day === todayDay()).length,
      courses: new Set(mine.map((e) => e.course_code)).size,
    };
  }, [store, teacher?.initial]);

  async function saveProfile() {
    if (!teacher) return;
    const updated = { ...teacher, ...form };
    await upsertTeacher(updated);
    updateSession({ name: form.name, email: form.email });
    setEditing(false);
    setMsg('Profile saved');
  }

  async function savePhoto(dataUrl: string | null) {
    if (!session || !teacher) return;
    const saved = await updateOwnProfilePic(
      { role: session.role, id: session.id, teacherInitial: teacher.initial },
      dataUrl,
    );
    updateSession({ profilePic: saved });
    setMsg(dataUrl ? 'Profile photo updated' : 'Profile photo removed');
  }

  async function onPw(e: FormEvent) {
    e.preventDefault();
    if (!teacher) return;
    if (next !== confirm) {
      setErr('Passwords do not match');
      return;
    }
    try {
      await changePassword('teacher', teacher.id, current, next);
      setMsg('Password updated');
      setPwOpen(false);
      setErr('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed');
    }
  }

  if (!teacher) {
    return (
      <div className="page">
        <p>Teacher profile not found</p>
        <Link to="/teacher">Back</Link>
      </div>
    );
  }

  return (
    <div className="page profile-stage">
      <PageHero
        variant="page"
        kicker="Faculty account"
        title="My Profile"
        trailing={<PortalAlerts noticesTo="/teacher/notifications" tone="on-light" />}
        actions={
          <div className="row-gap">
            <Link to="/teacher" className="icon-btn" title="Back to teaching desk">
              <ArrowLeft size={20} />
            </Link>
            {!editing ? (
              <button className="btn-outline" style={{ width: 'auto' }} onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : (
              <>
                <button className="btn-primary" style={{ width: 'auto' }} onClick={() => void saveProfile()}>
                  Save
                </button>
                <button className="btn-outline" style={{ width: 'auto' }} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        }
      />

      <section className="profile-banner">
        <div className="profile-banner-inner profile-banner-inner--photo-right">
          <div className="profile-banner__copy">
            <h2>{teacher.name}</h2>
            <p>
              {teacher.designation} · {teacher.initial}
            </p>
            <div className="profile-chips">
              <span className="profile-chip">
                <Briefcase size={14} /> {teacher.home_department}
              </span>
              {teacher.email && (
                <span className="profile-chip">
                  <Mail size={14} /> {teacher.email}
                </span>
              )}
              {teacher.phone && (
                <span className="profile-chip">
                  <Phone size={14} /> {teacher.phone}
                </span>
              )}
            </div>
          </div>
          <ProfileAvatar
            src={photo}
            name={teacher.name}
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
            <PushNotificationToggle />
          </div>
          <Link to="/teacher/notifications" className="btn-outline profile-prefs__notices">
            <Bell size={16} />
            Notices
            {unread > 0 ? <span className="nav-badge">{unread > 9 ? '9+' : unread}</span> : null}
          </Link>
        </div>
      </section>

      <div className="profile-stat-row">
        <div className="profile-stat">
          <strong>{load.today}</strong>
          <span>Today</span>
        </div>
        <div className="profile-stat" style={{ animationDelay: '60ms' }}>
          <strong>{load.week}</strong>
          <span>Weekly load</span>
        </div>
        <div className="profile-stat" style={{ animationDelay: '120ms' }}>
          <strong>{load.courses}</strong>
          <span>Courses</span>
        </div>
      </div>

      <div className="profile-grid">
        <section className="profile-panel">
          <div className="row-between">
            <h3>
              <Sparkles size={16} style={{ marginRight: 8 }} /> Teacher info
            </h3>
            {editing && <span className="warn-badge">Editing</span>}
          </div>
          {(
            [
              ['name', 'Name'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['designation', 'Designation'],
              ['home_department', 'Department'],
            ] as const
          ).map(([key, label]) =>
            editing ? (
              <label key={key} className="stack-tight">
                <span className="muted">{label}</span>
                <input
                  className="input"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ) : (
              <div key={key} className="info-row">
                <span className="muted">{label}</span>
                <strong>{form[key] || '—'}</strong>
              </div>
            ),
          )}
          <div className="info-row">
            <span className="muted">Initial</span>
            <strong>{teacher.initial}</strong>
          </div>
        </section>

        <section className="profile-panel">
          <div className="row-between">
            <h3>
              <Shield size={16} style={{ marginRight: 8 }} /> Security
            </h3>
            {!teacher.has_changed_password && (
              <button className="link-btn" onClick={() => setPwOpen((o) => !o)}>
                {pwOpen ? 'Close' : 'Change'}
              </button>
            )}
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {teacher.has_changed_password
              ? 'You already changed your password once. If you forget it, ask the Chairman to reset it.'
              : 'You may change the department password once. Chairman can reset it if you forget.'}
          </p>
          {pwOpen && !teacher.has_changed_password && (
            <form className="stack" onSubmit={onPw}>
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
              <button className="btn-primary">Update Password</button>
            </form>
          )}
          {(msg || err) && (
            <div className={err ? 'error-banner' : 'success-banner'}>{err || msg}</div>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>
            Data source: {store?.source === 'supabase' ? 'Supabase' : store?.source || 'Local'}
          </p>
          <div style={{ marginTop: 12 }}>
            <InstallAppButton />
          </div>
        </section>

        <GoogleCalendarPanel />
      </div>
    </div>
  );
}
