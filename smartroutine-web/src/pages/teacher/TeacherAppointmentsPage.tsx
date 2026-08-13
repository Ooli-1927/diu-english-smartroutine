import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useAppointments } from '../../hooks/useAppointments';
import { AppointmentCard } from '../../components/AppointmentCard';
import { BrandMark } from '../../components/BrandMark';
import type { AppointmentStatus } from '../../lib/types';

const filters: Array<AppointmentStatus | 'all'> = ['pending', 'accepted', 'rejected', 'all'];

export function TeacherAppointmentsPage() {
  const { items, loading, error, supported, respond } = useAppointments();
  const [filter, setFilter] = useState<AppointmentStatus | 'all'>('pending');
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((a) => a.status === filter)),
    [items, filter],
  );

  async function decide(id: string, status: AppointmentStatus) {
    setBusyId(id);
    setErr('');
    try {
      await respond(id, status, remarks[id]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update request');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className="teacher-hero compact">
        <div className="row-gap topbar-brand">
          <Link to="/teacher" className="hero-icon-btn">
            <ArrowLeft size={18} />
          </Link>
          <BrandMark variant="compact" title="Appointments" subtitle="DIU · Department of English" />
        </div>
        <div className="day-pills">
          {filters.map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </header>

      <div className="page-content pad-top">
        {!supported && (
          <div className="empty-state">
            Appointments require the live DIU server. Offline / demo mode cannot accept or reject
            meeting requests.
          </div>
        )}
        {err && <div className="error-banner">{err}</div>}
        {supported && loading && <div className="empty-state">Loading…</div>}
        {supported && error && <div className="error-banner">{error}</div>}
        {supported && !loading && !visible.length && (
          <div className="empty-state">No {filter === 'all' ? '' : filter} requests</div>
        )}
        {visible.map((a) => (
          <AppointmentCard
            key={a.id}
            appointment={a}
            audience="teacher"
            actions={
              a.status === 'pending' ? (
                <div className="stack">
                  <input
                    className="input"
                    placeholder="Remarks (optional)"
                    value={remarks[a.id] || ''}
                    onChange={(e) => setRemarks({ ...remarks, [a.id]: e.target.value })}
                  />
                  <div className="row-2">
                    <button
                      className="btn-outline danger"
                      disabled={busyId === a.id}
                      onClick={() => void decide(a.id, 'rejected')}
                    >
                      <X size={14} /> Reject
                    </button>
                    <button
                      className="btn-primary"
                      disabled={busyId === a.id}
                      onClick={() => void decide(a.id, 'accepted')}
                    >
                      <Check size={14} /> Accept
                    </button>
                  </div>
                </div>
              ) : null
            }
          />
        ))}
      </div>
    </>
  );
}
