import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Wrench,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { conflictLabel, summarizeConflicts, type Conflict } from '../lib/conflicts';
import { suggestFixes, type Suggestion } from '../lib/resolve';
import { DAYS, formatTime } from '../lib/constants';
import type { DayCode, TimetableEntry } from '../lib/types';

interface Props {
  conflicts: Conflict[];
  /** Shown collapsed by default; clashes are opened automatically. */
  title?: string;
  /** Always expanded (dedicated Conflicts page). */
  forceOpen?: boolean;
  /** Optional day filter — only that day's clashes. */
  dayFilter?: DayCode | 'All';
}

export function ConflictPanel({
  conflicts,
  title = 'Conflict checker',
  forceOpen = false,
  dayFilter = 'All',
}: Props) {
  const { store, courseByCode, teacherByInitial, batchById, roomById, updateTimetableEntry } =
    useData();
  const navigate = useNavigate();
  const visible = useMemo(
    () => (dayFilter === 'All' ? conflicts : conflicts.filter((c) => c.day === dayFilter)),
    [conflicts, dayFilter],
  );
  const summary = summarizeConflicts(visible);
  const [open, setOpen] = useState(forceOpen || summary.total > 0);
  /** Which class's fix panel is open: `${conflictIndex}:${entryId}`. */
  const [fixing, setFixing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const clean = summary.total === 0;

  useEffect(() => {
    if (!forceOpen && summary.total > 0) setOpen(true);
  }, [dayFilter, summary.total, forceOpen]);

  const rooms = useMemo(() => store?.rooms || [], [store]);
  const timetable = useMemo(() => store?.timetable || [], [store]);

  /** Only days that actually have clashes — never empty day sections. */
  const byDay = useMemo(() => {
    const map = new Map<DayCode, Conflict[]>();
    for (const c of visible) {
      const list = map.get(c.day) || [];
      list.push(c);
      map.set(c.day, list);
    }
    return DAYS.filter((d) => map.has(d)).map((d) => ({
      day: d,
      items: map.get(d) || [],
    }));
  }, [visible]);

  function describe(entry: TimetableEntry) {
    const course = courseByCode(entry.course_code);
    const teacher = teacherByInitial(entry.teacher_initial);
    const batch = batchById(entry.batch_id);
    const room = roomById(entry.room_id);
    return {
      title: course?.title || entry.course_code,
      code: entry.course_code,
      batch: batch?.name || entry.batch_id,
      teacher: teacher ? `${teacher.initial} — ${teacher.name}` : entry.teacher_initial,
      room: entry.mode === 'Online' ? 'Online' : room?.name || entry.room_id || 'TBA',
      when: `${entry.day} ${formatTime(entry.start_time)}–${formatTime(entry.end_time)}`,
      type: entry.group_name ? `${entry.type} (${entry.group_name})` : entry.type,
    };
  }

  function openSchedule(entry: TimetableEntry) {
    navigate(`/admin/timetable?day=${entry.day}&focus=${entry.id}`);
  }

  async function applyFix(entry: TimetableEntry, suggestion: Suggestion) {
    setBusy(true);
    setError('');
    setDone('');
    try {
      await updateTimetableEntry(entry.id, suggestion.patch);
      setFixing(null);
      setDone(`Applied: ${suggestion.label}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply the fix');
    } finally {
      setBusy(false);
    }
  }

  function toggleFix(key: string) {
    setError('');
    setDone('');
    setFixing((current) => (current === key ? null : key));
  }

  const expanded = forceOpen || open;

  return (
    <section className={`conflict-card ${clean ? 'ok' : 'warn'}`}>
      {!forceOpen && (
        <button type="button" className="conflict-card__head" onClick={() => setOpen((o) => !o)}>
          {clean ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <div className="conflict-card__title">
            <strong>{title}</strong>
            <span className="muted">
              {clean
                ? 'No room, teacher or batch clashes in the routine'
                : `${summary.total} clash${summary.total === 1 ? '' : 'es'} on ${byDay.length} day${
                    byDay.length === 1 ? '' : 's'
                  }: ` +
                  [
                    summary.room ? `${summary.room} room` : '',
                    summary.teacher ? `${summary.teacher} teacher` : '',
                    summary.batch ? `${summary.batch} batch` : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
            </span>
          </div>
          {!clean && (expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />)}
        </button>
      )}

      {expanded && !clean && (
        <div className="conflict-items">
          {error && <div className="error-banner">{error}</div>}
          {done && <div className="success-banner">{done}</div>}

          {byDay.map(({ day, items }) => (
            <section key={day} className="conflict-day">
              <header className="conflict-day__head">
                <strong>{day}</strong>
                <span className="muted">
                  {items.length} clash{items.length === 1 ? '' : 'es'}
                </span>
              </header>

              {items.map((conflict, index) => {
                const [left, right] = conflict.entries;
                const keyBase = `${day}-${conflict.kind}-${conflict.resource}-${left?.id}-${right?.id}-${index}`;
                return (
                  <article className="conflict-item" key={keyBase}>
                    <div className="conflict-item__head">
                      <span className={`conflict-kind ${conflict.kind}`}>
                        {conflictLabel(conflict.kind)}
                      </span>
                      <strong>
                        {formatTime(conflict.start_time)}–{formatTime(conflict.end_time)}
                      </strong>
                      <span className="muted conflict-resource">
                        {conflict.kind === 'room' && `Room ${conflict.resource}`}
                        {conflict.kind === 'teacher' && `Teacher ${conflict.resource}`}
                        {conflict.kind === 'batch' && `Batch ${conflict.resource}`}
                      </span>
                    </div>

                    <p className="conflict-vs">
                      <strong>{left?.course_code}</strong> ({left?.batch_id}
                      {left?.group_name ? ` ${left.group_name}` : ''}) clashes with{' '}
                      <strong>{right?.course_code}</strong> ({right?.batch_id}
                      {right?.group_name ? ` ${right.group_name}` : ''})
                    </p>

                    <div className="conflict-pair">
                      {conflict.entries.map((entry) => {
                        const info = describe(entry);
                        const key = `${keyBase}:${entry.id}`;
                        const openFixes = fixing === key;
                        const suggestions = openFixes
                          ? suggestFixes(entry, timetable, rooms)
                          : [];

                        return (
                          <div className="conflict-entry" key={entry.id}>
                            <div className="conflict-entry__body">
                              <button
                                type="button"
                                className="link-btn conflict-entry__title"
                                onClick={() => openSchedule(entry)}
                                title="Open this class in the timetable"
                              >
                                {info.title} <ExternalLink size={13} />
                              </button>
                              <ul className="conflict-meta">
                                <li>
                                  <span>When</span> {info.when}
                                </li>
                                <li>
                                  <span>Batch</span> {info.batch}
                                </li>
                                <li>
                                  <span>Course</span> {info.code} · {info.type}
                                </li>
                                <li>
                                  <span>Teacher</span> {info.teacher}
                                </li>
                                <li>
                                  <span>Room</span> {info.room}
                                </li>
                              </ul>
                            </div>

                            <div className="conflict-entry__actions">
                              <button
                                type="button"
                                className="btn-outline sm"
                                onClick={() => openSchedule(entry)}
                              >
                                <ExternalLink size={14} /> Go to schedule
                              </button>
                              <button
                                type="button"
                                className={`btn-outline sm ${openFixes ? 'active' : ''}`}
                                onClick={() => toggleFix(key)}
                              >
                                <Wrench size={14} />
                                {openFixes ? 'Hide options' : 'Resolve'}
                              </button>
                            </div>

                            {openFixes && (
                              <div className="suggestion-list">
                                {suggestions.length === 0 ? (
                                  <p className="muted">
                                    No automatic fix for this class. Try Resolve on the other class,
                                    or free a room / period first.
                                  </p>
                                ) : (
                                  <>
                                    <p className="muted">
                                      Pick one — any of these clears this clash:
                                    </p>
                                    {suggestions.map((s) => (
                                      <button
                                        key={s.id}
                                        type="button"
                                        className={`suggestion kind-${s.kind}`}
                                        disabled={busy}
                                        onClick={() => void applyFix(entry, s)}
                                      >
                                        <ArrowRight size={14} />
                                        <span>
                                          <strong>{s.label}</strong>
                                          <em>{s.detail}</em>
                                        </span>
                                      </button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {expanded && clean && forceOpen && (
        <div className="conflict-items">
          <p className="muted" style={{ margin: 0 }}>
            No room, teacher or batch clashes in the routine
            {dayFilter !== 'All' ? ` on ${dayFilter}` : ''}.
          </p>
        </div>
      )}
    </section>
  );
}
