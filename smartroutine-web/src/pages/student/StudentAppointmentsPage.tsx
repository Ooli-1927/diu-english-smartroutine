import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useAppointments } from '../../hooks/useAppointments';
import { PageHero } from '../../components/PageHero';
import { AppointmentCard } from '../../components/AppointmentCard';

export function StudentAppointmentsPage() {
  const { session } = useAuth();
  const { store, batchById } = useData();
  const { items, loading, error, supported, request } = useAppointments();
  const [params, setParams] = useSearchParams();
  const preselected = params.get('teacher') || '';

  const [form, setForm] = useState({
    teacher_initial: preselected,
    date: '',
    time: '',
    purpose: '',
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (preselected) {
      setForm((f) => ({ ...f, teacher_initial: preselected }));
    }
  }, [preselected]);

  const teacher = store?.teachers.find((t) => t.initial === form.teacher_initial);
  const batch = batchById(session?.batchId || '');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (!form.purpose.trim()) {
      setErr('Please write why you need this appointment');
      return;
    }
    setSaving(true);
    try {
      await request({
        teacher_initial: form.teacher_initial,
        date: form.date,
        time: form.time,
        purpose: form.purpose.trim(),
      });
      setForm({
        teacher_initial: preselected || '',
        date: '',
        time: '',
        purpose: '',
      });
      if (params.has('teacher')) setParams({}, { replace: true });
      setMsg(
        'Request sent — the teacher gets an email + in-app notice. You will also get email when they accept or reject.',
      );
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
        kicker="Office hours"
        title="Appointments"
        icon={
          <Link to="/student/teacher" title="Back to teachers">
            <ArrowLeft size={22} color="#fff" />
          </Link>
        }
        subtitle="Send a meeting request to a teacher"
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
                value={form.teacher_initial}
                onChange={(e) => setForm({ ...form, teacher_initial: e.target.value })}
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
            <div className="row-2">
              <label className="stack-label">
                Preferred date
                <input
                  className="input"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </label>
              <label className="stack-label">
                Preferred time
                <input
                  className="input"
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                  required
                />
              </label>
            </div>
            <label className="stack-label">
              Reason / purpose
              <textarea
                className="input"
                rows={3}
                placeholder="e.g. Thesis discussion, makeup class, project feedback…"
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                required
              />
            </label>
            {err && <div className="error-banner">{err}</div>}
            {msg && <div className="success-banner">{msg}</div>}
            <button className="btn-primary" disabled={saving}>
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
