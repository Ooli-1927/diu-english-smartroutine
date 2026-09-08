import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  DoorOpen,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { ScheduleCard } from '../../components/ScheduleCard';
import { UserAvatar } from '../../components/ProfileAvatar';
import { CalendarExportButton } from '../../components/CalendarExportButton';
import { RoutinePdfButton } from '../../components/RoutinePdfButton';
import { BrandMark } from '../../components/BrandMark';
import { PortalAlerts } from '../../components/PortalAlerts';
import { CLASS_MODES, CLASS_TYPES, DAYS, formatTime, todayDay } from '../../lib/constants';
import { conflictMessages } from '../../lib/conflicts';
import { listFreeRooms, listRescheduleOptions, type Suggestion } from '../../lib/resolve';
import type { DayCode, TimetableEntry } from '../../lib/types';

export function TeacherPortalPage() {
  const { session } = useAuth();
  const {
    store,
    courseByCode,
    updateTimetableEntry,
  } = useData();
  const [day, setDay] = useState<DayCode>(todayDay());
  const [active, setActive] = useState<TimetableEntry | null>(null);
  const [modal, setModal] = useState<'cancel' | 'room' | 'reschedule' | null>(null);
  const [reason, setReason] = useState('');
  const [roomId, setRoomId] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [filterDay, setFilterDay] = useState<DayCode | 'All'>('All');
  const [flash, setFlash] = useState('');
  const [form, setForm] = useState({
    type: 'Lecture' as TimetableEntry['type'],
    mode: 'Onsite' as TimetableEntry['mode'],
  });

  const initial = session?.teacherInitial || '';

  const weekEntries = useMemo(() => {
    if (!store || !initial) return [];
    return store.timetable.filter((e) => e.teacher_initial === initial);
  }, [store, initial]);

  const entries = useMemo(() => {
    return weekEntries
      .filter((e) => e.day === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [weekEntries, day]);

  /** Only rooms that do not create a clash at this class's current period. */
  const freeRooms = useMemo(() => {
    if (!store || !active) return [];
    return listFreeRooms(active, store.timetable, store.rooms);
  }, [store, active]);

  /** Clash-free day/period options for the reschedule modal. */
  const slotOptions = useMemo(() => {
    if (!store || !active || modal !== 'reschedule') return [];
    const draft = { ...active, type: form.type, mode: form.mode };
    if (form.mode === 'Online') {
      draft.room_id = null;
    }
    return listRescheduleOptions(draft, store.timetable, store.rooms);
  }, [store, active, modal, form.type, form.mode]);

  const visibleSlots = useMemo(
    () => (filterDay === 'All' ? slotOptions : slotOptions.filter((s) => s.patch.day === filterDay)),
    [slotOptions, filterDay],
  );

  const daysWithSlots = useMemo(() => {
    const set = new Set(slotOptions.map((s) => s.patch.day as DayCode));
    return DAYS.filter((d) => set.has(d));
  }, [slotOptions]);

  function openCancel(e: TimetableEntry) {
    setActive(e);
    setReason('');
    setProblems([]);
    setModal('cancel');
  }
  function openRoom(e: TimetableEntry) {
    setActive(e);
    setRoomId(e.room_id || '');
    setProblems([]);
    setModal('room');
  }
  function openReschedule(e: TimetableEntry) {
    setActive(e);
    setProblems([]);
    setPicked(null);
    setFilterDay('All');
    setForm({ type: e.type, mode: e.mode });
    setModal('reschedule');
  }

  /** A teacher may never save into a clash, so failures stay inside the modal. */
  async function apply(patch: Partial<TimetableEntry>, kind?: 'cancel' | 'restore' | 'other') {
    if (!active && kind !== 'restore') return;
    try {
      const id = active?.id;
      if (!id && kind !== 'restore') return;
      if (id) await updateTimetableEntry(id, patch);
      setProblems([]);
      setModal(null);
      if (kind === 'cancel' || kind === 'restore') {
        try {
          const res = await fetch('/api/health');
          const health = (await res.json()) as { mail?: string };
          if (health.mail === 'outbox' || health.mail === 'off') {
            setFlash(
              kind === 'cancel'
                ? 'Class cancelled. In-app notices went out, but email delivery is off.'
                : 'Class restored. Email delivery is off.',
            );
          } else {
            setFlash(
              kind === 'cancel'
                ? 'Class cancelled — emails are being sent to the batch (check inbox/spam; first-time addresses may need a Confirm link).'
                : 'Class restored — update emails are being sent.',
            );
          }
        } catch {
          setFlash(kind === 'cancel' ? 'Class cancelled.' : 'Class restored.');
        }
      }
    } catch (err) {
      const clashes = conflictMessages(err);
      setProblems(clashes || [err instanceof Error ? err.message : 'Could not save the change']);
    }
  }

  const applyCancel = () =>
    void apply(
      {
        is_cancelled: true,
        cancellation_reason: reason || 'Cancelled by teacher',
      },
      'cancel',
    );
  const applyRoom = () => void apply({ room_id: roomId || null });
  const applyReschedule = () => {
    if (!picked) {
      setProblems(['Pick an available day and time first']);
      return;
    }
    void apply({
      ...picked.patch,
      type: form.type,
      mode: form.mode,
      ...(form.mode === 'Online' ? { room_id: null } : {}),
    });
  };

  async function restore(e: TimetableEntry) {
    setActive(e);
    try {
      await updateTimetableEntry(e.id, { is_cancelled: false, cancellation_reason: null });
      setProblems([]);
      setActive(null);
      try {
        const res = await fetch('/api/health');
        const health = (await res.json()) as { mail?: string };
        setFlash(
          health.mail === 'outbox' || health.mail === 'off'
            ? 'Class restored. Email delivery is off.'
            : 'Class restored — update emails are being sent.',
        );
      } catch {
        setFlash('Class restored.');
      }
    } catch (err) {
      const clashes = conflictMessages(err);
      setProblems(clashes || [err instanceof Error ? err.message : 'Could not restore the class']);
    }
  }

  return (
    <>
      <header className="teacher-hero">
        <div className="teacher-hero__row">
          <div className="teacher-hero__main">
            <BrandMark
              variant="topbar"
              title="Teaching desk"
              subtitle={
                session?.name
                  ? `${session.name}${session.teacherInitial ? ` · ${session.teacherInitial}` : ''}`
                  : 'Department of English'
              }
            />
            <div className="day-pills teacher-hero__days">
              {DAYS.map((d) => (
                <button
                  key={d}
                  className={day === d ? 'active' : ''}
                  onClick={() => setDay(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="teacher-hero__alerts">
            <PortalAlerts noticesTo="/teacher/notifications" />
          </div>
          <div className="teacher-hero__photo">
            <UserAvatar
              src={session?.profilePic}
              name={session?.name || 'T'}
              className="hero-photo"
            />
            <p className="teacher-hero__photo-caption">
              {session?.teacherInitial || 'Faculty'}
            </p>
          </div>
        </div>
      </header>

      {flash && (
        <div className="warn-banner" style={{ margin: '12px 16px 0' }}>
          <AlertTriangle size={16} />
          <div>
            <strong>{flash}</strong>
            <button
              type="button"
              className="btn-outline"
              style={{ width: 'auto', marginTop: 8 }}
              onClick={() => setFlash('')}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="page-content pad-top">
        <div>
          <span className="brand-kicker">Your roster</span>
          <h3 className="section-title" style={{ marginTop: 8 }}>
            {day} schedule
          </h3>
        </div>
        {initial ? (
          <div className="schedule-export-row">
            <RoutinePdfButton
              kind="teacher"
              teacherInitial={initial}
              teacherName={session?.name || null}
              label="Download PDF"
            />
            <CalendarExportButton
              audience="teacher"
              entries={weekEntries}
              fileLabel={initial}
            />
          </div>
        ) : null}
        {problems.length > 0 && !modal && (
          <div className="warn-banner">
            <AlertTriangle size={16} />
            <div>
              <strong>Change not saved</strong>
              <ul>
                {problems.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {entries.length === 0 && (
          <div className="empty-state">
            <p>No classes on {day}</p>
          </div>
        )}
        {entries.map((e) => (
          <ScheduleCard
            key={e.id}
            entry={e}
            showTeacher={false}
            actions={
              e.is_cancelled ? (
                <button className="btn-success" onClick={() => restore(e)}>
                  Restore Class
                </button>
              ) : (
                <div className="row-3">
                  <button className="btn-outline" onClick={() => openReschedule(e)}>
                    <CalendarClock size={14} /> Reschedule
                  </button>
                  <button className="btn-outline" onClick={() => openRoom(e)}>
                    <DoorOpen size={14} /> Room
                  </button>
                  <button className="btn-outline danger" onClick={() => openCancel(e)}>
                    <XCircle size={14} /> Cancel
                  </button>
                </div>
              )
            }
          />
        ))}
      </div>

      {modal && active && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {problems.length > 0 && (
              <div className="warn-banner">
                <AlertTriangle size={16} />
                <div>
                  <strong>Pick another slot — this change clashes</strong>
                  <ul>
                    {problems.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {modal === 'cancel' && (
              <>
                <h3>Cancel Class</h3>
                <p className="muted">{courseByCode(active.course_code)?.title}</p>
                <input
                  className="input"
                  placeholder="Enter reason for cancellation"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="row-2">
                  <button className="btn-outline" onClick={() => setModal(null)}>
                    Back
                  </button>
                  <button className="btn-danger" onClick={applyCancel}>
                    Cancel Class
                  </button>
                </div>
              </>
            )}
            {modal === 'room' && (
              <>
                <h3>Change Room</h3>
                <p className="muted">
                  Only rooms free on {active.day} {formatTime(active.start_time)}–
                  {formatTime(active.end_time)} are listed.
                </p>
                <select
                  className="input"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                >
                  <option value="">Select room</option>
                  {freeRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {!freeRooms.length && (
                  <p className="muted">No free room in this period — try rescheduling instead.</p>
                )}
                <div className="row-2">
                  <button className="btn-outline" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={applyRoom}
                    disabled={!roomId || !freeRooms.some((r) => r.id === roomId)}
                  >
                    Update
                  </button>
                </div>
              </>
            )}
            {modal === 'reschedule' && (
              <>
                <h3>Reschedule Class</h3>
                <p className="muted">
                  {courseByCode(active.course_code)?.title || active.course_code} · currently{' '}
                  {active.day} {formatTime(active.start_time)}–{formatTime(active.end_time)}
                </p>
                <p className="muted small">
                  Only clash-free slots are shown (teacher, batch and room checked).
                </p>

                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => {
                    setPicked(null);
                    setForm({ ...form, type: e.target.value as TimetableEntry['type'] });
                  }}
                >
                  {CLASS_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={form.mode}
                  onChange={(e) => {
                    setPicked(null);
                    setForm({ ...form, mode: e.target.value as TimetableEntry['mode'] });
                  }}
                >
                  {CLASS_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>

                <div className="day-pills dark">
                  <button
                    type="button"
                    className={filterDay === 'All' ? 'active' : ''}
                    onClick={() => setFilterDay('All')}
                  >
                    All ({slotOptions.length})
                  </button>
                  {daysWithSlots.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={filterDay === d ? 'active' : ''}
                      onClick={() => setFilterDay(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                <div className="slot-option-list">
                  {visibleSlots.length === 0 ? (
                    <p className="muted">
                      No free slot left for this class. Try another mode, or ask admin to free a
                      period.
                    </p>
                  ) : (
                    visibleSlots.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`slot-option ${picked?.id === s.id ? 'selected' : ''}`}
                        onClick={() => {
                          setProblems([]);
                          setPicked(s);
                        }}
                      >
                        <strong>{s.label}</strong>
                        <span className="muted">{s.detail}</span>
                      </button>
                    ))
                  )}
                </div>

                <div className="row-2">
                  <button className="btn-outline" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={applyReschedule}
                    disabled={!picked}
                  >
                    Save
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
