import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { api } from '../../lib/api';
import { DAYS } from '../../lib/constants';
import { findConflicts } from '../../lib/conflicts';
import { ConflictPanel } from '../../components/ConflictPanel';
import { PageHero } from '../../components/PageHero';
import type {
  ClassMode,
  ClassType,
  DayCode,
  GenerateResult,
  RoutineRequirement,
} from '../../lib/types';

const CLASS_TYPES: ClassType[] = ['Lecture', 'Tutorial', 'Sessional', 'Online'];
const CLASS_MODES: ClassMode[] = ['Onsite', 'Online', 'Offline'];
const WORK_DAYS: DayCode[] = DAYS.filter((d) => d !== 'Fri');

export function AdminGeneratePage() {
  const { store, mode, refresh } = useData();
  const navigate = useNavigate();

  const [batches, setBatches] = useState<string[]>([]);
  const [rows, setRows] = useState<RoutineRequirement[]>([]);
  const [days, setDays] = useState<DayCode[]>(WORK_DAYS);
  const [replace, setReplace] = useState(true);
  const [maxBatch, setMaxBatch] = useState(3);
  const [maxTeacher, setMaxTeacher] = useState(4);
  const [preferMorning, setPreferMorning] = useState(false);
  const [noBackToBack, setNoBackToBack] = useState(true);
  const [avoidFri, setAvoidFri] = useState(true);
  const [preview, setPreview] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState<'load' | 'preview' | 'apply' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const conflicts = useMemo(() => findConflicts(store?.timetable || []), [store]);

  const grouped = useMemo(() => {
    const map = new Map<DayCode, GenerateResult['scheduled']>();
    for (const entry of preview?.scheduled || []) {
      const list = map.get(entry.day) || [];
      list.push(entry);
      map.set(entry.day, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return DAYS.filter((d) => map.has(d)).map((d) => ({ day: d, entries: map.get(d)! }));
  }, [preview]);

  function toggleBatch(id: string) {
    setBatches((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }

  function toggleDay(day: DayCode) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function updateRow(index: number, patch: Partial<RoutineRequirement>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function loadCurrent() {
    setBusy('load');
    setError('');
    setMessage('');
    try {
      const loaded = await api.timetableRequirements(batches);
      setRows(loaded);
      setPreview(null);
      setMessage(
        loaded.length
          ? `Loaded ${loaded.length} course assignments from the current routine.`
          : 'No existing classes found for the selected batches.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load requirements');
    } finally {
      setBusy(null);
    }
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        batch_id: batches[0] || store?.batches[0]?.id || '',
        course_code: store?.courses[0]?.code || '',
        teacher_initial: store?.teachers[0]?.initial || '',
        type: 'Lecture',
        mode: 'Onsite',
        group_name: null,
        sessions_per_week: 1,
      },
    ]);
  }

  async function run(dryRun: boolean) {
    if (!rows.length) {
      setError('Add at least one course assignment first.');
      return;
    }
    setBusy(dryRun ? 'preview' : 'apply');
    setError('');
    setMessage('');
    try {
      const result = await api.generateTimetable({
        requirements: rows.map((r) => ({
          ...r,
          sessions_per_week: Number(r.sessions_per_week) || 1,
          group_name: r.group_name || null,
        })),
        days,
        replace,
        dryRun,
        maxPerBatchPerDay: maxBatch,
        maxPerTeacherPerDay: maxTeacher,
        soft: {
          preferMorning,
          noBackToBack,
          avoidDays: avoidFri ? (['Fri'] as DayCode[]) : [],
          preferredDays: preferMorning ? (['Sat', 'Sun', 'Mon'] as DayCode[]) : [],
          maxConsecutive: 2,
        },
      });
      setPreview(result);
      if (!dryRun) {
        await refresh();
        setMessage(`Saved ${result.stats.placed} classes to the timetable.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(null);
    }
  }

  if (mode !== 'api') {
    return (
      <div className="admin-page">
        <PageHero
          variant="admin"
          kicker="AI · Scheduler"
          title="Generate Routine"
          subtitle="The routine generator runs on the live server. Offline / demo mode cannot preview or apply generated routines."
        />
        <div className="empty-state">
          Generate / apply requires the live DIU API. Start the server and reload to use it.
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="AI · Scheduler"
        title="Generate Routine"
        subtitle="Conflict-free scheduling for teachers, rooms and batches"
      />
      <ConflictPanel conflicts={conflicts} title="Current routine conflicts" />

      <section className="card pad stack">
        <div className="field-label">1. Choose batches</div>
        <div className="chip-row">
          {store?.batches.map((b) => (
            <button
              key={b.id}
              className={`chip ${batches.includes(b.id) ? 'active' : ''}`}
              onClick={() => toggleBatch(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
        <div className="row-gap wrap">
          <button className="btn-outline" onClick={() => void loadCurrent()} disabled={busy !== null}>
            <Download size={16} />
            {busy === 'load' ? 'Loading…' : 'Load from current routine'}
          </button>
          <button className="btn-outline" onClick={addRow}>
            <Plus size={16} /> Add course row
          </button>
        </div>
      </section>

      <section className="card pad stack">
        <div className="field-label">2. Course assignments ({rows.length})</div>
        {!rows.length && (
          <p className="muted">
            Load the current routine to regenerate it, or add rows manually.
          </p>
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Course</th>
                  <th>Teacher</th>
                  <th>Type</th>
                  <th>Mode</th>
                  <th>Group</th>
                  <th>Per week</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.batch_id}-${r.course_code}-${r.group_name || ''}-${i}`}>
                    <td>
                      <select
                        className="input compact"
                        value={r.batch_id}
                        onChange={(e) => updateRow(i, { batch_id: e.target.value })}
                      >
                        {store?.batches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="input compact"
                        value={r.course_code}
                        onChange={(e) => updateRow(i, { course_code: e.target.value })}
                      >
                        {store?.courses.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="input compact"
                        value={r.teacher_initial}
                        onChange={(e) => updateRow(i, { teacher_initial: e.target.value })}
                      >
                        {store?.teachers.map((t) => (
                          <option key={t.initial} value={t.initial}>
                            {t.initial}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="input compact"
                        value={r.type}
                        onChange={(e) => updateRow(i, { type: e.target.value as ClassType })}
                      >
                        {CLASS_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="input compact"
                        value={r.mode}
                        onChange={(e) => updateRow(i, { mode: e.target.value as ClassMode })}
                      >
                        {CLASS_MODES.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input compact"
                        placeholder="—"
                        value={r.group_name || ''}
                        onChange={(e) => updateRow(i, { group_name: e.target.value || null })}
                      />
                    </td>
                    <td>
                      <input
                        className="input compact"
                        type="number"
                        min={1}
                        max={6}
                        value={r.sessions_per_week}
                        onChange={(e) =>
                          updateRow(i, { sessions_per_week: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="icon-btn danger"
                        onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card pad stack">
        <div className="field-label">3. Rules</div>
        <div className="chip-row">
          {WORK_DAYS.map((d) => (
            <button
              key={d}
              className={`chip ${days.includes(d) ? 'active' : ''}`}
              onClick={() => toggleDay(d)}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="row-3">
          <label className="stack-label">
            Max classes per batch per day
            <input
              className="input"
              type="number"
              min={1}
              max={6}
              value={maxBatch}
              onChange={(e) => setMaxBatch(Number(e.target.value))}
            />
          </label>
          <label className="stack-label">
            Max classes per teacher per day
            <input
              className="input"
              type="number"
              min={1}
              max={8}
              value={maxTeacher}
              onChange={(e) => setMaxTeacher(Number(e.target.value))}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            Replace existing classes of these batches
          </label>
        </div>
        <div className="row-gap wrap">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferMorning}
              onChange={(e) => setPreferMorning(e.target.checked)}
            />
            Soft: prefer morning slots
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={noBackToBack}
              onChange={(e) => setNoBackToBack(e.target.checked)}
            />
            Soft: avoid teacher back-to-back
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={avoidFri}
              onChange={(e) => setAvoidFri(e.target.checked)}
            />
            Soft: avoid Friday pressure
          </label>
        </div>
        <div className="row-gap wrap">
          <button className="btn-outline" onClick={() => void run(true)} disabled={busy !== null}>
            <Sparkles size={16} />
            {busy === 'preview' ? 'Generating…' : 'Preview'}
          </button>
          <button
            className="btn-primary"
            onClick={() => void run(false)}
            disabled={busy !== null || !preview}
            title={preview ? '' : 'Preview first'}
          >
            <Wand2 size={16} />
            {busy === 'apply' ? 'Saving…' : 'Apply to timetable'}
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {message && <div className="success-banner">{message}</div>}
      </section>

      {preview && (
        <section className="stack">
          <div className="stat-grid">
            <div className="card pad">
              <p className="muted">Requested</p>
              <strong className="stat-value">{preview.stats.requested}</strong>
            </div>
            <div className="card pad">
              <p className="muted">Placed</p>
              <strong className="stat-value">{preview.stats.placed}</strong>
            </div>
            <div className="card pad">
              <p className="muted">Skipped</p>
              <strong className="stat-value">{preview.stats.skipped}</strong>
            </div>
            <div className="card pad">
              <p className="muted">Status</p>
              <strong className="stat-value small-value">
                {preview.applied ? 'Saved' : 'Preview only'}
              </strong>
            </div>
          </div>

          {preview.unscheduled.length > 0 && (
            <div className="card pad stack">
              <div className="field-label warn">
                <AlertTriangle size={18} /> Could not place {preview.unscheduled.length} session(s)
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Course</th>
                      <th>Teacher</th>
                      <th>Session</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.unscheduled.map((u, i) => (
                      <tr key={`${u.course_code}-${u.session}-${i}`}>
                        <td>{u.batch_id}</td>
                        <td>{u.course_code}</td>
                        <td>{u.teacher_initial}</td>
                        <td className="muted">{u.session}</td>
                        <td className="muted">{u.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {grouped.map(({ day, entries }) => (
            <div key={day} className="card pad stack">
              <div className="row-between">
                <strong>{day}</strong>
                <span className="muted">{entries.length} classes</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Batch</th>
                      <th>Course</th>
                      <th>Teacher</th>
                      <th>Type</th>
                      <th>Room</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={`${e.course_code}-${e.start_time}-${i}`}>
                        <td>
                          {e.start_time}–{e.end_time}
                        </td>
                        <td>{e.batch_id}</td>
                        <td>
                          {e.course_code}
                          {e.group_name ? ` (${e.group_name})` : ''}
                        </td>
                        <td>{e.teacher_initial}</td>
                        <td>{e.type}</td>
                        <td>{e.room_id || 'Online'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {preview.applied && (
            <button className="btn-outline" onClick={() => navigate('/admin/timetable')}>
              <CheckCircle2 size={16} /> Open timetable
            </button>
          )}
        </section>
      )}
    </div>
  );
}
