import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, MapPin, Plus, Trash2, X } from 'lucide-react';
import { useAppointments } from '../../hooks/useAppointments';
import { useOfficeHours } from '../../hooks/useOfficeHours';
import { AppointmentCard } from '../../components/AppointmentCard';
import { BrandMark } from '../../components/BrandMark';
import { PortalAlerts } from '../../components/PortalAlerts';
import { DAYS, formatTime } from '../../lib/constants';
import type { AppointmentStatus, DayCode } from '../../lib/types';

const filters: Array<AppointmentStatus | 'all'> = ['pending', 'accepted', 'rejected', 'all'];

function filterLabel(f: AppointmentStatus | 'all') {
  if (f === 'rejected') return 'declined';
  return f;
}

export function TeacherAppointmentsPage() {
  const { items, loading, error, supported, respond } = useAppointments();
  const hours = useOfficeHours();
  const [filter, setFilter] = useState<AppointmentStatus | 'all'>('pending');
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [slotMsg, setSlotMsg] = useState('');
  const [savingSlot, setSavingSlot] = useState(false);
  const [form, setForm] = useState({
    day: 'Sun' as DayCode,
    start_time: '11:00',
    end_time: '12:00',
    location: '',
    note: '',
  });

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

  async function addSlot() {
    setSlotMsg('');
    setSavingSlot(true);
    try {
      await hours.publish({
        day: form.day,
        start_time: form.start_time,
        end_time: form.end_time,
        location: form.location.trim(),
        note: form.note.trim(),
      });
      setForm((f) => ({ ...f, location: '', note: '' }));
      setSlotMsg('Appointment schedule published — students can now book these times.');
    } catch (e) {
      setSlotMsg(e instanceof Error ? e.message : 'Could not save slot');
    } finally {
      setSavingSlot(false);
    }
  }

  return (
    <>
      <header className="teacher-hero compact">
        <div className="row-between">
          <div className="row-gap topbar-brand">
            <Link to="/teacher" className="hero-icon-btn">
              <ArrowLeft size={18} />
            </Link>
            <BrandMark variant="compact" title="Appointments" subtitle="Schedule · student requests" />
          </div>
          <PortalAlerts noticesTo="/teacher/notifications" />
        </div>
        <div className="day-pills">
          {filters.map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {filterLabel(f)}
            </button>
          ))}
        </div>
      </header>

      <div className="page-content pad-top">
        {!supported && (
          <div className="empty-state">
            Appointments require the live DIU server. Offline / demo mode cannot publish a schedule or
            answer meeting requests.
          </div>
        )}

        {supported && (
          <section className="card pad office-hours-panel">
            <h3 className="section-title" style={{ marginTop: 0 }}>
              My appointment schedule
            </h3>
            <p className="muted small">
              Publish the days and times students may request a meeting. They only see these slots.
              You accept, decline, or leave a request pending.
            </p>

            <div className="office-hours-form">
              <label className="stack-label">
                Day
                <select
                  className="input"
                  value={form.day}
                  onChange={(e) => setForm({ ...form, day: e.target.value as DayCode })}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="stack-label">
                From
                <input
                  className="input"
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                />
              </label>
              <label className="stack-label">
                To
                <input
                  className="input"
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                />
              </label>
              <label className="stack-label office-hours-form__wide">
                Room / location (optional)
                <input
                  className="input"
                  placeholder="e.g. Room 2701 or Google Meet"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </label>
            </div>
            <div className="office-hours-publish">
            <label className="stack-label">
              Note for students (optional)
              <input
                className="input"
                placeholder="e.g. Thesis / advising only"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
            {slotMsg && (
              <div className={/published|saved/i.test(slotMsg) ? 'success-banner' : 'error-banner'}>
                {slotMsg}
              </div>
            )}
            {hours.error && <div className="error-banner">{hours.error}</div>}
            <button
              className="btn-primary office-hours-publish__btn"
              type="button"
              disabled={savingSlot}
              onClick={() => void addSlot()}
            >
              <Plus size={16} /> {savingSlot ? 'Saving…' : 'Publish slot'}
            </button>
            </div>

            {hours.loading && <p className="muted">Loading your appointment schedule…</p>}
            {!hours.loading && !hours.slots.length && (
              <div className="empty-state">No appointment schedule yet — add at least one slot so students can book.</div>
            )}
            <ul className="office-hours-list">
              {hours.slots.map((s) => (
                <li key={s.id} className={`office-hours-item${s.is_active ? '' : ' is-paused'}`}>
                  <div>
                    <strong>
                      {s.day} · {formatTime(s.start_time)} – {formatTime(s.end_time)}
                    </strong>
                    <p className="muted small">
                      {s.location ? (
                        <span className="row-gap">
                          <MapPin size={12} /> {s.location}
                        </span>
                      ) : (
                        'No room set'
                      )}
                      {s.note ? ` · ${s.note}` : ''}
                      {s.is_active ? '' : ' · hidden from students'}
                    </p>
                  </div>
                  <div className="row-gap">
                    <button
                      type="button"
                      className="btn-outline sm"
                      onClick={() => void hours.update(s.id, { is_active: !s.is_active })}
                    >
                      {s.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      className="btn-outline danger sm"
                      onClick={() => void hours.remove(s.id)}
                      aria-label="Delete slot"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {err && <div className="error-banner">{err}</div>}
        {supported && loading && <div className="empty-state">Loading requests…</div>}
        {supported && error && <div className="error-banner">{error}</div>}
        {supported && !loading && !visible.length && (
          <div className="empty-state">No {filter === 'all' ? '' : filterLabel(filter)} requests</div>
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
                      <X size={14} /> Decline
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
