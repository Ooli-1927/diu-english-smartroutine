import { useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  Clock3,
  DoorOpen,
  MapPin,
  UserRound,
  Users,
} from 'lucide-react';
import { PageHero } from '../../components/PageHero';
import { useData } from '../../context/DataContext';
import { SearchBox } from '../../components/SearchBox';
import { DAYS, formatTime, timesOverlap, todayDay } from '../../lib/constants';
import { timetableSlots } from '../../lib/resolve';
import type { DayCode, TimetableEntry } from '../../lib/types';

type StatusFilter = 'all' | 'free' | 'busy';

export function RoomSearchPage() {
  const { store, courseByCode, teacherByInitial, batchById } = useData();
  const slots = useMemo(() => timetableSlots(store?.timetable || []), [store]);
  const defaultSlot = slots[0] ? `${slots[0].start}|${slots[0].end}` : '';

  const [day, setDay] = useState<DayCode>(todayDay());
  const [slotKey, setSlotKey] = useState(defaultSlot);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const activeSlot = useMemo(() => {
    if (!slots.length) return null;
    const found = slots.find((s) => `${s.start}|${s.end}` === slotKey);
    return found || slots[0];
  }, [slots, slotKey]);

  const dayEntries = useMemo(() => {
    if (!store) return [];
    return store.timetable.filter(
      (e) => !e.is_cancelled && e.room_id && e.mode !== 'Online' && e.day === day,
    );
  }, [store, day]);

  const occupancy = useMemo(() => {
    const map = new Map<string, TimetableEntry[]>();
    if (!activeSlot) return map;
    for (const e of dayEntries) {
      if (!timesOverlap(e.start_time, e.end_time, activeSlot.start, activeSlot.end)) continue;
      const list = map.get(e.room_id!) || [];
      list.push(e);
      map.set(e.room_id!, list);
    }
    return map;
  }, [dayEntries, activeSlot]);

  const nextByRoom = useMemo(() => {
    const map = new Map<string, TimetableEntry>();
    if (!activeSlot) return map;
    for (const e of dayEntries) {
      if (e.start_time < activeSlot.end) continue;
      const prev = map.get(e.room_id!);
      if (!prev || e.start_time < prev.start_time) map.set(e.room_id!, e);
    }
    return map;
  }, [dayEntries, activeSlot]);

  const rooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(store?.rooms || [])]
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .filter((r) => {
        if (q && !r.id.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) {
          return false;
        }
        const busy = (occupancy.get(r.id)?.length || 0) > 0;
        if (status === 'free') return !busy;
        if (status === 'busy') return busy;
        return true;
      })
      .map((r) => ({
        room: r,
        classes: occupancy.get(r.id) || [],
        busy: (occupancy.get(r.id)?.length || 0) > 0,
        next: nextByRoom.get(r.id) || null,
      }));
  }, [store, query, status, occupancy, nextByRoom]);

  const totalRooms = store?.rooms.length || 0;
  const freeCount = useMemo(
    () => (store?.rooms || []).filter((r) => !(occupancy.get(r.id)?.length)).length,
    [store, occupancy],
  );
  const busyCount = totalRooms - freeCount;
  const utilPct = totalRooms ? Math.round((busyCount / totalRooms) * 100) : 0;

  return (
    <div className="page student-page student-page--rooms">
      <PageHero
        variant="page"
        kicker="Campus map"
        title="Rooms"
        icon={<DoorOpen size={22} color="#fff" />}
        subtitle={
          activeSlot
            ? `${day} · ${formatTime(activeSlot.start)}–${formatTime(activeSlot.end)} · DIU English campus`
            : 'Pick a day and period'
        }
      />

      <div className="room-kpi">
        <article className="room-kpi__card">
          <span className="room-kpi__label">Rooms</span>
          <strong>{totalRooms}</strong>
          <p className="muted">Tracked this campus block</p>
        </article>
        <article className="room-kpi__card is-free">
          <span className="room-kpi__label">Free now</span>
          <strong>{freeCount}</strong>
          <p className="muted">Open for the selected period</p>
        </article>
        <article className="room-kpi__card is-busy">
          <span className="room-kpi__label">Busy</span>
          <strong>{busyCount}</strong>
          <p className="muted">{utilPct}% occupied</p>
        </article>
        <article className="room-kpi__card">
          <span className="room-kpi__label">Period</span>
          <strong className="room-kpi__period">
            {activeSlot ? `${formatTime(activeSlot.start)}` : '—'}
          </strong>
          <p className="muted">{day} slot focus</p>
        </article>
      </div>

      <div className="room-explorer">
        <aside className="room-explorer__side card pad">
          <div className="field-label">When</div>
          <label className="room-field">
            <span className="muted small">Day</span>
            <select
              className="input"
              value={day}
              onChange={(e) => setDay(e.target.value as DayCode)}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="room-field">
            <span className="muted small">Period</span>
            <select
              className="input"
              value={activeSlot ? `${activeSlot.start}|${activeSlot.end}` : ''}
              onChange={(e) => setSlotKey(e.target.value)}
              disabled={!slots.length}
            >
              {slots.map((s) => (
                <option key={`${s.start}|${s.end}`} value={`${s.start}|${s.end}`}>
                  {formatTime(s.start)} – {formatTime(s.end)}
                </option>
              ))}
            </select>
          </label>

          <div className="field-label" style={{ marginTop: 8 }}>
            Status
          </div>
          <div className="room-status-stack">
            {(
              [
                ['all', `All rooms (${totalRooms})`],
                ['free', `Free (${freeCount})`],
                ['busy', `Busy (${busyCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`room-status-btn ${status === key ? 'active' : ''}`}
                onClick={() => setStatus(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="muted small room-side-note">
            Live occupancy from the official DIU English routine — cancelled and online classes are
            ignored.
          </p>
        </aside>

        <div className="room-explorer__main">
          <div className="room-explorer__toolbar card pad">
            <SearchBox value={query} onChange={setQuery} placeholder="Filter by room number or name" />
            <div className="row-between result-line" style={{ margin: 0 }}>
              <span className="muted">
                Showing {rooms.length} room{rooms.length === 1 ? '' : 's'}
              </span>
              <span className="muted small">
                {freeCount} free · {busyCount} busy
              </span>
            </div>
          </div>

          {rooms.length === 0 ? (
            <div className="empty-state">
              <Building2 size={36} />
              <p>No rooms match this filter</p>
            </div>
          ) : (
            <div className="room-grid">
              {rooms.map(({ room, classes, busy, next }) => (
                <article
                  key={room.id}
                  className={`card room-tile ${busy ? 'is-busy' : 'is-free'}`}
                >
                  <header className="room-tile__head">
                    <div className="room-tile__id">
                      <MapPin size={16} />
                      <strong>{room.name}</strong>
                      <span className="muted small">{room.id !== room.name ? room.id : 'Campus room'}</span>
                    </div>
                    <span className={`status-chip ${busy ? 'rejected' : 'accepted'}`}>
                      {busy ? 'Busy' : 'Free'}
                    </span>
                  </header>

                  {busy ? (
                    <ul className="room-tile__classes">
                      {classes.map((e) => {
                        const course = courseByCode(e.course_code);
                        const teacher = teacherByInitial(e.teacher_initial);
                        const batch = batchById(e.batch_id);
                        return (
                          <li key={e.id}>
                            <div className="room-tile__course">
                              <BookOpen size={14} />
                              <div>
                                <strong>{course?.title || e.course_code}</strong>
                                <p className="muted small">
                                  {e.course_code}
                                  {e.type ? ` · ${e.type}` : ''}
                                  {e.group_name ? ` · Group ${e.group_name}` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="room-tile__meta">
                              <span>
                                <Users size={13} /> {batch?.name || e.batch_id}
                              </span>
                              <span>
                                <UserRound size={13} />{' '}
                                {teacher?.name || e.teacher_initial}
                                {teacher?.name ? ` (${e.teacher_initial})` : ''}
                              </span>
                              <span>
                                <Clock3 size={13} /> {formatTime(e.start_time)}–
                                {formatTime(e.end_time)}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="room-tile__free">
                      <p>Available this period — good for study / makeup.</p>
                      {next ? (
                        <p className="muted small">
                          Next: {courseByCode(next.course_code)?.title || next.course_code} ·{' '}
                          {formatTime(next.start_time)}–{formatTime(next.end_time)} ·{' '}
                          {teacherByInitial(next.teacher_initial)?.initial || next.teacher_initial}
                        </p>
                      ) : (
                        <p className="muted small">No later class booked in this room today.</p>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
