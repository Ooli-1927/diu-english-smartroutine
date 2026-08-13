import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { useAuth, portalPath } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { ThemeToggle } from '../components/ThemeToggle';

const connectionLabels: Record<string, string> = {
  api: 'Live server connected',
  supabase: 'Supabase fallback connected',
  local: 'Offline demo (no live server)',
  unknown: 'Connecting to server…',
};

export function LoginPage() {
  const { login } = useAuth();
  const { mode } = useData();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const session = await login(username, password);
      navigate(portalPath(session.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden>
        <div className="login-bg__campus" />
        <div className="login-bg__aurora login-bg__aurora--a" />
        <div className="login-bg__aurora login-bg__aurora--b" />
        <div className="login-bg__grid" />
        <div className="login-bg__marks">
          <div className="login-bg__mark-wrap login-bg__mark-wrap--diu">
            <img
              src="/branding/diu-university-logo.png"
              alt=""
              className="login-bg__mark login-bg__mark--diu"
            />
            <span className="login-bg__halo login-bg__halo--diu" />
          </div>
          <div className="login-bg__mark-wrap login-bg__mark-wrap--eng">
            <img
              src="/branding/diu-english-dept-logo.png?v=4"
              alt=""
              className="login-bg__mark login-bg__mark--eng"
            />
            <span className="login-bg__halo login-bg__halo--eng" />
          </div>
        </div>
        <div className="login-bg__veil" />
        {/* Orbits above the veil so rings/nodes stay readable */}
        <div className="login-bg__orbit login-bg__orbit--outer" />
        <div className="login-bg__orbit login-bg__orbit--mid" />
        <div className="login-bg__orbit login-bg__orbit--inner" />
        <div className="login-bg__sparks">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="login-bg__glow" />
      </div>

      <div className="login-shell">
        <aside className="login-brand">
          <a
            className="login-brand__logo-link"
            href="https://daffodilvarsity.edu.bd/"
            target="_blank"
            rel="noreferrer"
            title="Daffodil International University"
          >
            <img
              className="login-brand__logo"
              src="/branding/diu-university-logo.png"
              alt="Daffodil International University"
            />
          </a>
          <p className="login-brand__kicker">Official university portal identity</p>
          <h1 className="login-brand__title">Daffodil International University</h1>
          <p className="login-brand__uni">
            Shaping futures with a global vision — ranked among the world&apos;s best, proudly #1 in
            Bangladesh.
          </p>
          <p className="login-brand__motto">Learner-centric · Technology-driven · Impactful research</p>
          <ul className="login-brand__points">
            <li>38 programs across 6 faculties</li>
            <li>Undergraduate &amp; graduate pathways</li>
            <li>Global SDG leadership &amp; campus excellence</li>
          </ul>
          <a
            className="login-brand__ext"
            href="https://daffodilvarsity.edu.bd/"
            target="_blank"
            rel="noreferrer"
          >
            daffodilvarsity.edu.bd <ExternalLink size={14} />
          </a>
        </aside>

        <form className="login-card" onSubmit={onSubmit}>
          <ThemeToggle />

          <div className="login-mobile-diu">
            <img src="/branding/diu-university-logo.png" alt="Daffodil International University" />
          </div>

          <div className="login-card__crest">
            <img
              src="/branding/diu-english-dept-logo.png?v=4"
              alt="Department of English, Daffodil International University"
            />
          </div>

          <div className="login-card__head">
            <p className="login-card__dept">Department of English</p>
            <h2>SmartRoutine</h2>
            <p className="login-uni-name">Faculty of Humanities &amp; Social Sciences</p>
            <p className="subtitle">Sapere Aude · Class routine for DIU English</p>
          </div>

          <div className="field-label">
            <ShieldCheck size={18} /> Sign in
          </div>

          <label className="field">
            <User size={18} className="field-icon" />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username or institutional email"
              autoComplete="username"
              required
            />
          </label>

          <label className="field">
            <Lock size={18} className="field-icon" />
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
            />
            <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label="Toggle password">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </label>

          {error && <div className="error-banner">{error}</div>}

          {mode !== 'api' && mode !== 'unknown' && (
            <div className="login-offline-notice">
              {mode === 'local'
                ? 'Offline / demo mode — the live API is unreachable. Sign in with demo credentials; changes stay in this browser only.'
                : 'Supabase fallback — the live DIU API is offline. Sign in is still required; this is not the production server.'}
            </div>
          )}

          <button className="btn-primary login-submit" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Enter English portal'}
          </button>

          <a
            className="login-card__dept-link"
            href="https://daffodilvarsity.edu.bd/department/english"
            target="_blank"
            rel="noreferrer"
          >
            Department of English on DIU <ExternalLink size={13} />
          </a>

          <p className="demo-hints">
            Seed credentials are generated at setup time and printed to the API console — see SETUP.md.
          </p>

          <div className={`backend-pill ${mode} centered`}>{connectionLabels[mode]}</div>
        </form>
      </div>

      <footer className="login-footer">
        Daffodil International University · Department of English · SmartRoutine
      </footer>
    </div>
  );
}
