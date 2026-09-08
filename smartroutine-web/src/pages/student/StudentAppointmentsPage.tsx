import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useAppointments } from '../../hooks/useAppointments';
import { useOfficeHours } from '../../hooks/useOfficeHours';
import { PageHero } from '../../components/PageHero';
import { AppointmentCard } from '../../components/AppointmentCard';
import { formatTime } from '../../lib/constants';

export function StudentAppointmentsPage() {
  const { session } = useAuth();
  const { store, batchById } = useData();
  const { items, loading, error, supported, request } = useAppointments();
  const [params, setParams] = useSearchParams();
  const preselected = params.get('teacher') || '';

  const [teacherInitial, setTeacherInitial] = useState(preselected);
  const [picked, setPicked] = useState<{
    slot_id: string;
    date: string;
    time: string;
    end: string;
    day: string;
  } | null>(null);
  const [purpose, setPurpose] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const hours = useOfficeHours(teacherInitial || undefined);

  useEffect(() => {
    if (preselected) setTeacherInitial(preselected);
  }, [preselected]);

  useEffect(() => {
    setPicked(null);
  }, [teacherInitial]);

  const teacher = store?.teachers.find((t) => t.initial === teacherInitial);
  const batch = batchById(session?.batchId || '');

  const bookedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const a of items) {
      if (a.teacher_initial !== teacherInitial) continue;
      if (a.status === 'rejected') continue;
      keys.add(`${a.date}|${a.time.slice(0, 5)}`);
    }
    return keys;
  }, [items, teacherInitial]);

  const windows = useMemo(
    () =>
      hours.windows.filter((w) => !bookedKeys.has(`${w.date}|${w.start_time.slice(0, 5)}`)),
    [hours.windows, bookedKeys],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (!teacherInitial) {
      setErr('Select a teacher');
      return;
    }
    if (!picked) {
      setErr('Pick one of this teacher’s published times');
      return;
    }
    if (!purpose.trim()) {
      setErr('Please write why you need this appointment');
      return;
    }
    setSaving(true);
    try {
      await request({
        teacher_initial: teacherInitial,
        date: picked.date,
        time: picked.time,
        slot_id: picked.slot_id,
        purpose: purpose.trim(),
      });
      setPurpose('');
      setPicked(null);
      if (params.has('teacher')) setParams({}, { replace: true });
      setMsg('Request sent as Pending. You will see Accepted or Declined after the teacher responds.');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not send request');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <PageHero
        variant="page"
        kicker="Meetings"
        title="Appointments"
        icon={
          <Link to="/student/teacher" title="Back to teachers">
            <ArrowLeft size={22} color="#fff" />
          </Link>
        }
        subtitle="Book only the times each teacher has published on their appointment schedule"
      />

      {!supported ? (
        <div className="empty-state">
          Appointments require the live DIU server. Offline / demo mode cannot create or send
          meeting requests.
        </div>
      ) : (
        <>
          <div className="card pad student-request-meta">
            <p className="muted small">Requesting as</p>
            <strong>{session?.name}</strong>
            <p className="muted">
              ID {session?.studentId}
              {batch ? ` · ${batch.name}` : ''}
              {session?.email ? ` · ${session.email}` : ''}
            </p>
          </div>

          <form className="card pad stack" onSubmit={onSubmit}>
            <div className="field-label">
              <CalendarPlus size={18} /> Meeting details
            </div>
            <label className="stack-label">
              Teacher
              <select
                className="input"
                value={teacherInitial}
                onChange={(e) => setTeacherInitial(e.target.value)}
                required
              >
                <option value="">Select teacher</option>
                {store?.teachers.map((t) => (
                  <option key={t.id} value={t.initial}>
                    {t.initial} — {t.name}
                  </option>
                ))}
              </select>
            </label>
            {teacher && (
              <p className="muted small">
                {teacher.designation}
                {teacher.email ? ` · ${teacher.email}` : ''}
              </p>
            )}

            {teacherInitial && hours.loading && <p className="muted">Loading appointment schedule…</p>}
            {teacherInitial && hours.error && <div className="error-banner">{hours.error}</div>}
            {teacherInitial && !hours.loading && !hours.slots.length && (
              <div className="empty-state">
                This teacher has not published an appointment schedule yet. You cannot send a request
                until they add slots in the teacher portal.
              </div>
            )}

            {!!hours.slots.length && (
              <div className="office-week-summary">
                {hours.slots.map((s) => (
                  <span key={s.id} className="chip">
                    {s.day} {formatTime(s.start_time)}–{formatTime(s.end_time)}
                    {s.location ? ` · ${s.location}` : ''}
                  </span>
                ))}
              </div>
            )}

            {!!windows.length && (
              <label className="stack-label">
                Available times (next 3 weeks)
                <div className="office-slot-grid">
                  {windows.map((w) => {
                    const selected =
                      picked?.slot_id === w.slot_id &&
                      picked.date === w.date &&
                      picked.time === w.start_time;
                    return (
                      <button
                        key={`${w.slot_id}-${w.date}-${w.start_time}`}
                        type="button"
                        className={`office-slot-btn${selected ? ' is-selected' : ''}`}
                        onClick={() =>
                          setPicked({
                            slot_id: w.slot_id,
                            date: w.date,
                            time: w.start_time,
                            end: w.end_time,
                            day: w.day,
                          })
                        }
                      >
                        <strong>
                          {w.day} {w.date}
                        </strong>
                        <span>
                          {formatTime(w.start_time)} – {formatTime(w.end_time)}
                        </span>
                        {w.location ? <span className="muted small">{w.location}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </label>
            )}

            {picked && (
              <p className="muted small">
                Selected: {picked.day} {picked.date} · {formatTime(picked.time)} – {formatTime(picked.end)}
              </p>
            )}

            <label className="stack-label">
              Reason / purpose
              <textarea
                className="input"
                rows={3}
                placeholder="e.g. Thesis discussion, makeup class, project feedback…"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                required
              />
            </label>
            {err && <div className="error-banner">{err}</div>}
            {msg && <div className="success-banner">{msg}</div>}
            <button className="btn-primary" disabled={saving || !picked}>
              {saving ? 'Sending…' : 'Send request'}
            </button>
          </form>

          <h3 className="section-title">My requests</h3>
          {loading && <div className="empty-state">Loading…</div>}
          {error && <div className="error-banner">{error}</div>}
          {!loading && !items.length && (
            <div className="empty-state">You have not requested any meetings yet</div>
          )}
          {items.map((a) => (
            <AppointmentCard key={a.id} appointment={a} audience="student" />
          ))}
        </>
      )}
    </div>
  );
}
