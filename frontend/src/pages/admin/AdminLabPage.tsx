import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bot,
  Building2,
  FlaskConical,
  History,
  MapPin,
  Radar,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useData } from '../../context/DataContext';
import { DAYS, todayDay } from '../../lib/constants';
import type { DayCode, TimetableEntry } from '../../lib/types';

type Tab =
  | 'whatif'
  | 'occupancy'
  | 'negotiate'
  | 'predict'
  | 'semesters'
  | 'audit'
  | 'nl'
  | 'attendance';

const tabs: Array<{ id: Tab; label: string; icon: typeof FlaskConical }> = [
  { id: 'whatif', label: 'What-if', icon: FlaskConical },
  { id: 'occupancy', label: 'Occupancy', icon: MapPin },
  { id: 'negotiate', label: 'Negotiate', icon: ShieldAlert },
  { id: 'predict', label: 'Predict', icon: Radar },
  { id: 'semesters', label: 'Semesters', icon: Archive },
  { id: 'audit', label: 'Audit', icon: History },
  { id: 'nl', label: 'NL Ops', icon: Bot },
  { id: 'attendance', label: 'Attendance', icon: ScanLine },
];

export function AdminLabPage() {
  const { store, refresh, mode } = useData();
  const [tab, setTab] = useState<Tab>('whatif');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const entries = store?.timetable || [];

  if (mode !== 'api') {
    return (
      <div className="admin-page ax-page">
        <div className="ax-hero" style={{ marginBottom: 8 }}>
          <div>
            <p className="ax-kicker">
              <Sparkles size={14} /> Lab · Advanced ops
            </p>
            <h1>SmartRoutine Lab</h1>
          </div>
        </div>
        <div className="empty-state">
          Lab features (attendance, occupancy, negotiations, semesters, audit, NL ops) require the
          live DIU server. Offline / demo mode cannot run them.
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page ax-page">
      <div className="ax-hero" style={{ marginBottom: 8 }}>
        <div>
          <p className="ax-kicker">
            <Sparkles size={14} /> Lab · Advanced ops
          </p>
          <h1>SmartRoutine Lab</h1>
          <p className="muted">
            Rare ops: digital twin, occupancy map, negotiations, QR attendance, predictive load,
            semester rollback, signed audit, natural-language commands.
          </p>
        </div>
      </div>

      <div className="day-pills dark" style={{ flexWrap: 'wrap' }}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={14} style={{ marginRight: 6 }} />
            {label}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {msg && <div className="success-banner">{msg}</div>}

      {tab === 'whatif' && (
        <WhatIfPanel
          entries={entries}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setMsg={setMsg}
        />
      )}
      {tab === 'occupancy' && <OccupancyPanel setError={setError} />}
      {tab === 'negotiate' && (
        <NegotiatePanel
          entries={entries}
          setError={setError}
          setMsg={setMsg}
          busy={busy}
          setBusy={setBusy}
        />
      )}
      {tab === 'predict' && <PredictPanel setError={setError} />}
      {tab === 'semesters' && (
        <SemestersPanel
          setError={setError}
          setMsg={setMsg}
          onRestored={() => void refresh()}
        />
      )}
      {tab === 'audit' && <AuditPanel setError={setError} />}
      {tab === 'nl' && (
        <NlPanel setError={setError} setMsg={setMsg} onChanged={() => void refresh()} />
      )}
      {tab === 'attendance' && <AttendanceAdminPanel setError={setError} entries={entries} />}
    </div>
  );
}

function WhatIfPanel({
  entries,
  busy,
  setBusy,
  setError,
  setMsg,
}: {
  entries: TimetableEntry[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
  setMsg: (v: string) => void;
}) {
  const [entryId, setEntryId] = useState(entries[0]?.id || '');
  const [day, setDay] = useState<DayCode>('Sat');
  const [cancel, setCancel] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!entryId && entries[0]) setEntryId(entries[0].id);
  }, [entries, entryId]);

  async function run() {
    setBusy(true);
    setError('');
    try {
      const r = await api.whatIf({
        patch: {
          entryId,
          ...(cancel ? { is_cancelled: true } : { day }),
        },
      });
      setResult(r as unknown as Record<string, unknown>);
      setMsg(String(r.suggestion || 'Simulation done'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulate failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad stack">
      <h3>Digital twin — what if?</h3>
      <p className="muted">Preview clash ripple before touching the live routine.</p>
      <div className="grid-form">
        <select className="input" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>
              {e.day} {e.start_time} · {e.course_code} · {e.teacher_initial}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={day}
          disabled={cancel}
          onChange={(e) => setDay(e.target.value as DayCode)}
        >
          {DAYS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <label className="row-gap">
          <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} />
          Simulate cancel instead of move
        </label>
      </div>
      <button className="btn-primary" style={{ width: 'auto' }} disabled={busy || !entryId} onClick={() => void run()}>
        Run simulation
      </button>
      {result && (
        <div className="profile-stat-row">
          <div className="profile-stat">
            <strong>{String(result.beforeCount)}</strong>
            <span>Clashes now</span>
          </div>
          <div className="profile-stat">
            <strong>{String(result.afterCount)}</strong>
            <span>After change</span>
          </div>
          <div className="profile-stat">
            <strong>{String(result.delta)}</strong>
            <span>Delta</span>
          </div>
        </div>
      )}
    </section>
  );
}

function OccupancyPanel({ setError }: { setError: (v: string) => void }) {
  const [data, setData] = useState<{
    day: string;
    rooms: Array<{
      id: string;
      name: string;
      status: string;
      scheduled: { course_code: string; teacher_initial: string } | null;
    }>;
  } | null>(null);

  async function load() {
    try {
      setData(await api.liveOccupancy());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Occupancy failed');
    }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="card pad stack">
      <div className="row-between">
        <h3>
          <Building2 size={16} /> Live campus occupancy · {data?.day || '—'}
        </h3>
        <button className="btn-outline" style={{ width: 'auto' }} onClick={() => void load()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <div className="ax-heat" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10 }}>
        {(data?.rooms || []).map((r) => (
          <div
            key={r.id}
            className="card pad"
            style={{
              borderLeft: `4px solid ${
                r.status === 'free' ? 'var(--success)' : r.status === 'full' ? 'var(--error)' : 'var(--warning)'
              }`,
            }}
          >
            <strong>{r.name}</strong>
            <p className="muted" style={{ textTransform: 'uppercase', fontSize: 12 }}>
              {r.status}
            </p>
            {r.scheduled && (
              <p style={{ fontSize: 13 }}>
                {r.scheduled.course_code} · {r.scheduled.teacher_initial}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function NegotiatePanel({
  entries,
  setError,
  setMsg,
  busy,
  setBusy,
}: {
  entries: TimetableEntry[];
  setError: (v: string) => void;
  setMsg: (v: string) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [list, setList] = useState<Array<Record<string, unknown>>>([]);

  async function refreshList() {
    try {
      setList((await api.listNegotiations()) as Array<Record<string, unknown>>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  useEffect(() => {
    void refreshList();
  }, []);

  async function create() {
    setBusy(true);
    try {
      const ea = entries.find((e) => e.id === a);
      const eb = entries.find((e) => e.id === b);
      await api.createNegotiation({
        entryAId: a,
        entryBId: b,
        kind: 'teacher',
        message: `Negotiate ${ea?.course_code} vs ${eb?.course_code}`,
        proposal: {
          moveEntryId: b,
          day: ea?.day,
          start_time: ea?.start_time,
          end_time: ea?.end_time,
          room_id: ea?.room_id ?? null,
          targetTeacher: eb?.teacher_initial,
        },
      });
      setMsg('Negotiation opened');
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad stack">
      <h3>Conflict negotiation</h3>
      <div className="grid-form">
        <select className="input" value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">Entry A</option>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>
              {e.course_code} · {e.teacher_initial} · {e.day}
            </option>
          ))}
        </select>
        <select className="input" value={b} onChange={(e) => setB(e.target.value)}>
          <option value="">Entry B</option>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>
              {e.course_code} · {e.teacher_initial} · {e.day}
            </option>
          ))}
        </select>
      </div>
      <button className="btn-primary" style={{ width: 'auto' }} disabled={!a || !b || busy} onClick={() => void create()}>
        Open negotiation
      </button>
      <ul className="ax-conflict-feed">
        {list.map((n) => (
          <li key={String(n.id)}>
            <span className={`ax-tag ${String(n.status)}`}>{String(n.status)}</span>
            <span>{String(n.message)}</span>
            {n.status === 'open' && (
              <button
                className="btn-outline sm"
                onClick={() =>
                  void api.respondNegotiation(String(n.id), true).then(() => {
                    setMsg('Accepted');
                    return refreshList();
                  })
                }
              >
                Accept
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PredictPanel({ setError }: { setError: (v: string) => void }) {
  const [data, setData] = useState<{
    burnout: Array<{ teacher: string; load: number; risk: string; advice: string }>;
    hotSlots: Array<{ day: string; hour: number; count: number; pressure: string }>;
    forecast: Array<{ teacher: string; nextWeekLoad: number; trend: string }>;
  } | null>(null);

  useEffect(() => {
    void api
      .predictive()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Predict failed'));
  }, [setError]);

  return (
    <div className="ax-bottom-grid">
      <section className="card pad">
        <h3>Burnout radar</h3>
        {(data?.burnout || []).slice(0, 8).map((b) => (
          <div key={b.teacher} className="info-row">
            <span>
              {b.teacher} · <em>{b.risk}</em>
            </span>
            <strong>{b.load}</strong>
          </div>
        ))}
      </section>
      <section className="card pad">
        <h3>Hot slots</h3>
        {(data?.hotSlots || []).slice(0, 8).map((h) => (
          <div key={`${h.day}-${h.hour}`} className="info-row">
            <span>
              {h.day} {String(h.hour).padStart(2, '0')}:00
            </span>
            <strong>
              {h.count} · {h.pressure}
            </strong>
          </div>
        ))}
      </section>
      <section className="card pad">
        <h3>Next-week forecast</h3>
        {(data?.forecast || []).map((f) => (
          <div key={f.teacher} className="info-row">
            <span>{f.teacher}</span>
            <strong>
              ~{f.nextWeekLoad} · {f.trend}
            </strong>
          </div>
        ))}
      </section>
    </div>
  );
}

function SemestersPanel({
  setError,
  setMsg,
  onRestored,
}: {
  setError: (v: string) => void;
  setMsg: (v: string) => void;
  onRestored: () => void;
}) {
  const [label, setLabel] = useState('');
  const [data, setData] = useState<{
    semesters: Array<{ id: string; label: string; is_active: number }>;
    snapshots: Array<{ id: string; label: string; entry_count: number; created_at: string }>;
  } | null>(null);

  async function load() {
    try {
      setData(await api.semesters());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="card pad stack">
      <h3>Semester versioning</h3>
      <div className="row-gap wrap">
        <input
          className="input"
          placeholder="New semester label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="btn-primary"
          style={{ width: 'auto' }}
          onClick={() =>
            void api.createSemester({ label }).then(() => {
              setLabel('');
              setMsg('Semester created');
              return load();
            })
          }
        >
          Create
        </button>
      </div>
      <div className="stack">
        {(data?.semesters || []).map((s) => (
          <div key={s.id} className="row-between">
            <span>
              {s.label} {s.is_active ? '· ACTIVE' : ''}
            </span>
            <div className="row-gap">
              <button
                className="btn-outline sm"
                onClick={() =>
                  void api.snapshotSemester(s.id, `${s.label} backup`).then(() => {
                    setMsg('Snapshot saved');
                    return load();
                  })
                }
              >
                Snapshot
              </button>
              <button
                className="btn-outline sm"
                onClick={() =>
                  void api.activateSemester(s.id).then(() => {
                    setMsg('Activated');
                    return load();
                  })
                }
              >
                Activate
              </button>
            </div>
          </div>
        ))}
      </div>
      <h4>Snapshots</h4>
      {(data?.snapshots || []).map((s) => (
        <div key={s.id} className="row-between">
          <span>
            {s.label} · {s.entry_count} classes
          </span>
          <button
            className="btn-outline danger sm"
            onClick={() => {
              if (!window.confirm('Restore this snapshot? Live timetable will be replaced.')) return;
              void api.restoreSnapshot(s.id).then(() => {
                setMsg('Restored');
                onRestored();
                return load();
              });
            }}
          >
            Restore
          </button>
        </div>
      ))}
    </section>
  );
}

function AuditPanel({ setError }: { setError: (v: string) => void }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void api
      .auditLog()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Audit failed'));
  }, [setError]);

  return (
    <section className="card pad">
      <h3>Signed audit trail</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{String(r.created_at || '').slice(0, 19)}</td>
                <td>
                  {String(r.actor_name || r.actor_id || '—')} · {String(r.actor_role || '')}
                </td>
                <td>{String(r.action)}</td>
                <td>{String(r.summary || '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NlPanel({
  setError,
  setMsg,
  onChanged,
}: {
  setError: (v: string) => void;
  setMsg: (v: string) => void;
  onChanged: () => void;
}) {
  const [text, setText] = useState('list conflicts');
  const [out, setOut] = useState<Record<string, unknown> | null>(null);

  async function run(execute: boolean) {
    try {
      const r = await api.nlOps(text, execute);
      setOut(r as unknown as Record<string, unknown>);
      setMsg(`Intent: ${r.intent} (${Math.round((r.confidence || 0) * 100)}%)`);
      if (execute) onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'NL failed');
    }
  }

  return (
    <section className="card pad stack">
      <h3>Natural-language ops</h3>
      <p className="muted">
        Try: &quot;list conflicts&quot;, &quot;free rooms Sat 10:15&quot;, &quot;cancel CSE 113 on Thu&quot;,
        &quot;snapshot routine&quot;
      </p>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row-gap">
        <button className="btn-outline" style={{ width: 'auto' }} onClick={() => void run(false)}>
          Plan
        </button>
        <button className="btn-primary" style={{ width: 'auto' }} onClick={() => void run(true)}>
          Execute
        </button>
      </div>
      {out && (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: 12,
            background: 'var(--surface)',
            padding: 12,
            borderRadius: 12,
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {JSON.stringify(out, null, 2)}
        </pre>
      )}
    </section>
  );
}

function AttendanceAdminPanel({
  setError,
  entries,
}: {
  setError: (v: string) => void;
  entries: TimetableEntry[];
}) {
  const weekday = todayDay();
  const today = useMemo(
    () =>
      entries
        .filter((e) => !e.is_cancelled && e.day === weekday)
        .sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [entries, weekday],
  );
  const [session, setSession] = useState<{ token: string; scanUrl: string; expires_at: string } | null>(
    null,
  );
  const [report, setReport] = useState<Array<Record<string, unknown>>>([]);

  return (
    <section className="card pad stack">
      <h3>QR attendance</h3>
      <p className="muted">
        Open a 30-minute scan session for today&apos;s classes ({weekday}). Students use
        /student/attendance.
      </p>
      <div className="row-gap wrap">
        {today.length === 0 && (
          <p className="muted">No active classes scheduled for {weekday}.</p>
        )}
        {today.slice(0, 12).map((e: TimetableEntry) => (
          <button
            key={e.id}
            type="button"
            className="btn-outline sm"
            onClick={() =>
              void api
                .openAttendance(e.id)
                .then((s) => {
                  setSession(s);
                  return api.attendanceReport(e.id).then(setReport);
                })
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : 'Failed'),
                )
            }
          >
            Open · {e.course_code} {e.day}
          </button>
        ))}
      </div>
      {session && (
        <div className="success-banner">
          Token: <code>{session.token}</code>
          <br />
          Scan path: {session.scanUrl}
          <br />
          Expires: {session.expires_at}
        </div>
      )}
      {report[0] && (
        <p className="muted">
          Last session records:{' '}
          {Array.isArray(report[0].records) ? (report[0].records as unknown[]).length : 0}
        </p>
      )}
    </section>
  );
}
