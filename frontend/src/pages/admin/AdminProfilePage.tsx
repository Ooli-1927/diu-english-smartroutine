import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Building2,
  Mail,
  Shield,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { ThemeToggle } from '../../components/ThemeToggle';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { PageHero } from '../../components/PageHero';
import { findConflicts } from '../../lib/conflicts';
import { api } from '../../lib/api';

export function AdminProfilePage() {
  const { session, updateSession } = useAuth();
  const { store, mode, updateOwnProfilePic } = useData();
  const [msg, setMsg] = useState('');
  const [mailTip, setMailTip] = useState('');
  const [mailMode, setMailMode] = useState('');
  const [professional, setProfessional] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [testTo, setTestTo] = useState('');
  const [mailBusy, setMailBusy] = useState(false);

  const admin = store?.admins.find((a) => a.id === session?.id);
  const photo = session?.profilePic || admin?.profile_pic || null;

  const overview = useMemo(() => {
    const clashes = findConflicts(store?.timetable || []).length;
    return {
      students: store?.students.length || 0,
      teachers: store?.teachers.length || 0,
      classes: store?.timetable.length || 0,
      clashes,
      batches: store?.batches.length || 0,
      rooms: store?.rooms.length || 0,
    };
  }, [store]);

  useEffect(() => {
    if (mode !== 'api') return;
    let alive = true;
    (async () => {
      try {
        const s = await api.mailStatus();
        if (!alive) return;
        setProfessional(Boolean(s.professional));
        setMailMode(s.mode || '');
        setMailTip(s.tip || '');
        if (s.smtpUser) setSmtpUser(s.smtpUser);
      } catch {
        /* offline / local mode */
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode]);

  async function savePhoto(dataUrl: string | null) {
    if (!session) return;
    const saved = await updateOwnProfilePic(
      { role: session.role, id: session.id },
      dataUrl,
    );
    updateSession({ profilePic: saved });
    setMsg(dataUrl ? 'Profile photo updated' : 'Profile photo removed');
  }

  async function saveSmtp() {
    if (mode !== 'api') return;
    setMailBusy(true);
    try {
      const s = await api.saveMailSmtp({
        user: smtpUser.trim(),
        pass: smtpPass.trim(),
        from: smtpUser.trim(),
        fromName: 'DIU SmartRoutine',
      });
      setProfessional(Boolean(s.professional));
      setMailMode(s.mode || '');
      setMailTip(s.tip || '');
      setSmtpPass('');
      setMsg('Professional email connected. Send a test below.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not save mail settings');
    } finally {
      setMailBusy(false);
    }
  }

  async function clearSmtp() {
    if (mode !== 'api') return;
    setMailBusy(true);
    try {
      const s = await api.clearMailSmtp();
      setProfessional(Boolean(s.professional));
      setMailMode(s.mode || '');
      setSmtpPass('');
      setMsg('SMTP cleared — fallback relay will be used.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not clear mail settings');
    } finally {
      setMailBusy(false);
    }
  }

  async function sendTest() {
    if (mode !== 'api') return;
    const to = testTo.trim();
    if (!to) {
      setMsg('Enter a test recipient email');
      return;
    }
    setMailBusy(true);
    try {
      const r = await api.testMail(to);
      setMailMode(r.mode || '');
      setProfessional(Boolean(r.professional));
      setMsg(
        r.professional
          ? `Professional HTML test sent to ${to}`
          : `Test sent to ${to} via relay (${r.mode}). Add Gmail App Password above for branded HTML.`,
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Test mail failed');
    } finally {
      setMailBusy(false);
    }
  }

  return (
    <div className="admin-page profile-stage" style={{ maxWidth: 960 }}>
      <PageHero
        variant="admin"
        kicker="Account · Chairman"
        title="Chairman profile"
        subtitle="Department of English console identity, photo and mail delivery settings."
        actions={
          <div className="page-actions">
            <Link to="/admin" className="btn-outline">
              <ArrowLeft size={16} /> Dashboard
            </Link>
            <ThemeToggle />
          </div>
        }
      />

      <section className="profile-banner">
        <div className="profile-banner-inner profile-banner-inner--photo-right">
          <div className="profile-banner__copy">
            <h1>{session?.username || 'Chairman'}</h1>
            <p>Department Super Admin · English Routine Control</p>
            <div className="profile-chips">
              <span className="profile-chip">
                <Shield size={14} /> Super Admin
              </span>
              <span className="profile-chip">
                <Building2 size={14} /> English
              </span>
              <span className="profile-chip">
                <Activity size={14} /> {mode === 'api' ? 'Live API' : mode}
              </span>
            </div>
          </div>
          <ProfileAvatar
            src={photo}
            name={session?.username || 'C'}
            size="xxl"
            editable
            onChange={savePhoto}
          />
        </div>
      </section>

      {msg && <div className="success-banner">{msg}</div>}

      <div className="profile-stat-row">
        <div className="profile-stat">
          <strong>{overview.students}</strong>
          <span>Students</span>
        </div>
        <div className="profile-stat" style={{ animationDelay: '50ms' }}>
          <strong>{overview.teachers}</strong>
          <span>Teachers</span>
        </div>
        <div className="profile-stat" style={{ animationDelay: '100ms' }}>
          <strong>{overview.classes}</strong>
          <span>Classes · {overview.clashes} clashes</span>
        </div>
      </div>

      <div className="profile-grid">
        <section className="profile-panel">
          <h3>
            <Users size={16} style={{ marginRight: 8 }} /> Authority
          </h3>
          <div className="info-row">
            <span className="muted">Username</span>
            <strong>{session?.username || 'chairman'}</strong>
          </div>
          <div className="info-row">
            <span className="muted">Role</span>
            <strong>Chairman / Super Admin</strong>
          </div>
          <div className="info-row">
            <span className="muted">Department assets</span>
            <strong>
              {overview.batches} batches · {overview.rooms} rooms
            </strong>
          </div>
          <div className="info-row">
            <span className="muted">Access</span>
            <strong>Full CRUD · Import PDF · Analytics · Notices</strong>
          </div>
          <div className="info-row">
            <span className="muted">Recovery</span>
            <strong>Can reset student & teacher passwords</strong>
          </div>
        </section>

        <section className="profile-panel">
          <h3>
            <Shield size={16} style={{ marginRight: 8 }} /> Workspace
          </h3>
          <p className="muted">
            Use the camera button on your avatar to upload a photo. Theme preference syncs on this
            device.
          </p>
          <div className="profile-actions">
            <ThemeToggle />
            <Link className="btn-outline" to="/admin/analytics" style={{ width: 'auto' }}>
              Open analytics
            </Link>
            <Link className="btn-primary" to="/admin/timetable" style={{ width: 'auto' }}>
              Manage timetable
            </Link>
          </div>
        </section>
      </div>

      <section className="profile-panel" style={{ marginTop: 20 }}>
        <h3>
          <Mail size={16} style={{ marginRight: 8 }} /> Professional email
        </h3>
        {mode !== 'api' ? (
          <div className="empty-state" style={{ margin: 0 }}>
            SMTP configuration and test mail require the live DIU server. Offline / demo mode cannot
            send email.
          </div>
        ) : (
          <>
        <p className="muted" style={{ marginBottom: 12 }}>
          Connect a Gmail <strong>App Password</strong> so cancel / reschedule emails send as branded
          HTML from your address. No app can force Inbox on every provider — use the filter tip below
          once for each recipient mailbox.
        </p>
        <div className="info-row">
          <span className="muted">Status</span>
          <strong>
            {professional ? 'Professional HTML (SMTP)' : 'Relay fallback'} · {mailMode || '—'}
          </strong>
        </div>
        {mailTip && (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {mailTip}
          </p>
        )}
        {professional && (
          <div
            className="muted"
            style={{
              fontSize: 13,
              margin: '12px 0',
              padding: '12px 14px',
              background: 'var(--surface-2, #f4f8f7)',
              borderRadius: 8,
              lineHeight: 1.55,
            }}
          >
            <strong style={{ color: 'inherit' }}>Inbox (one-time per recipient)</strong>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>Open the mail in Spam → <strong>Report not spam</strong></li>
              <li>
                Gmail → Settings → Filters → create filter: From = your SMTP address → Never send it
                to Spam
              </li>
            </ol>
          </div>
        )}
        <ol className="muted" style={{ fontSize: 13, margin: '12px 0', paddingLeft: 18 }}>
          <li>Google Account → Security → turn on 2-Step Verification</li>
          <li>App passwords → app = Mail → copy the 16-character password</li>
          <li>Paste Gmail + App Password below → Save → Send test</li>
        </ol>
        <div className="form-grid" style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
          <input
            type="email"
            placeholder="Gmail address (e.g. dept@gmail.com)"
            value={smtpUser}
            onChange={(e) => setSmtpUser(e.target.value)}
            autoComplete="off"
          />
          <input
            type="password"
            placeholder="16-character App Password"
            value={smtpPass}
            onChange={(e) => setSmtpPass(e.target.value)}
            autoComplete="new-password"
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              style={{ width: 'auto' }}
              disabled={mailBusy || !smtpUser.trim() || !smtpPass.trim()}
              onClick={() => void saveSmtp()}
            >
              Save SMTP
            </button>
            <button
              type="button"
              className="btn-outline"
              style={{ width: 'auto' }}
              disabled={mailBusy}
              onClick={() => void clearSmtp()}
            >
              Clear
            </button>
          </div>
          <input
            type="email"
            placeholder="Send test to…"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
          />
          <button
            type="button"
            className="btn-outline"
            style={{ width: 'auto' }}
            disabled={mailBusy || !testTo.trim()}
            onClick={() => void sendTest()}
          >
            Send test email
          </button>
        </div>
          </>
        )}
      </section>
    </div>
  );
}
