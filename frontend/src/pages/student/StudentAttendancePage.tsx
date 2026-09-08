import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
import { PageHero } from '../../components/PageHero';
import { api } from '../../lib/api';
import { useData } from '../../context/DataContext';

export function StudentAttendancePage() {
  const { mode } = useData();
  const [params] = useSearchParams();
  const [token, setToken] = useState(() => params.get('token') || '');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function scan() {
    if (mode !== 'api') return;
    const value = token.trim();
    if (!value) {
      setError('Attendance token din');
      return;
    }
    setError('');
    setMsg('');
    setLoading(true);
    try {
      const r = await api.scanAttendance(value);
      setMsg(`Marked present${r.course?.course_code ? ` · ${r.course.course_code}` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  }

  if (mode !== 'api') {
    return (
      <div className="page">
        <PageHero
          variant="page"
          kicker="Check-in"
          title="Attendance"
          icon={<ScanLine size={22} color="#fff" />}
          subtitle="QR attendance needs the live server."
        />
        <div className="empty-state">
          Attendance scanning requires the live DIU server. Offline / demo mode cannot mark
          presence.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHero
        variant="page"
        kicker="Check-in"
        title="Attendance"
        icon={<ScanLine size={22} color="#fff" />}
        subtitle="Teacher/Chairman je token dibe (Lab → Attendance) seta ekhane likho. Session 30 minute valid."
      />
      {error && <div className="error-banner">{error}</div>}
      {msg && <div className="success-banner">{msg}</div>}
      <section className="card pad stack">
        <input
          className="input"
          placeholder="Attendance token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
        <button
          className="btn-primary"
          type="button"
          disabled={loading || !token.trim()}
          onClick={() => void scan()}
        >
          {loading ? 'Checking…' : 'Mark present'}
        </button>
      </section>
    </div>
  );
}
