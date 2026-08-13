import { useMemo, useState } from 'react';
import { CalendarCheck, Clock, MapPin, Users } from 'lucide-react';
import { PageHero } from '../../components/PageHero';
import { useData } from '../../context/DataContext';
import { formatTime, timesOverlap, todayDay } from '../../lib/constants';
import { timetableSlots } from '../../lib/resolve';
import type { TimetableEntry } from '../../lib/types';

export function FreeRoomsPage() {
  const { store, courseByCode, teacherByInitial, batchById } = useData();
  const day = todayDay();
  const slots = useMemo(() => timetableSlots(store?.timetable || []), [store]);
  const [slotKey, setSlotKey] = useState<string | null>(null);

  const activeSlot = useMemo(() => {
    if (!slots.length) return null;
    const found = slots.find((s) => `${s.start}|${s.end}` === slotKey);
    return found || null;
  }, [slots, slotKey]);

  const occupancy = useMemo(() => {
    const map = new Map<string, TimetableEntry[]>();
    if (!store || !activeSlot) return map;
    for (const e of store.timetable) {
      if (
        e.is_cancelled ||
        !e.room_id ||
        e.mode === 'Online' ||
        e.day !== day ||
        !timesOverlap(e.start_time, e.end_time, activeSlot.start, activeSlot.end)
      ) {
        continue;
      }
      const list = map.get(e.room_id) || [];
      list.push(e);
      map.set(e.room_id, list);
    }
    return map;
  }, [store, day, activeSlot]);

  const rooms = useMemo(() => {
    return [...(store?.rooms || [])]
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map((r) => ({
        room: r,
        classes: occupancy.get(r.id) || [],
        busy: (occupancy.get(r.id)?.length || 0) > 0,
      }));
  }, [store, occupancy]);

  const freeCount = rooms.filter((r) => !r.busy).length;
  const busyCount = rooms.length - freeCount;
  const morning = slots.filter((s) => s.start < '13:00');
  const afternoon = slots.filter((s) => s.start >= '13:00');

  function SlotList({
    title,
    color,
    items,
  }: {
    title: string;
    color: string;
    items: Array<{ start: string; end: string }>;
  }) {
    if (!items.length) return null;
    return (
      <section className="slot-section">
        <div className="section-label" style={{ color }}>
          <span className="bar" style={{ background: color }} />
          {title}
        </div>
        {items.map((s) => {
          const key = `${s.start}|${s.end}`;
          return (
            <button
              key={key}
              type="button"
              className={`slot-card ${slotKey === key ? 'selected' : ''}`}
              onClick={() => setSlotKey(key)}
            >
              <Clock size={18} />
              <span>
                {formatTime(s.start)} – {formatTime(s.end)}
              </span>
            </button>
          );
        })}
      </section>
    );
  }

  return (
    <div className="page">
      <PageHero
        variant="page"
        kicker="Availability"
        title="Free Rooms"
        icon={<CalendarCheck size={22} color="#fff" />}
        subtitle={`Today · ${day} · from live timetable`}
      />

      <div className="page-content">
        {!slots.length && (
          <div className="empty-state">
            <p>No class periods in the timetable yet</p>
          </div>
        )}

        <SlotList title="MORNING" color="#FF9F0A" items={morning} />
        <SlotList title="AFTERNOON" color="#4366F6" items={afternoon} />

        {activeSlot && (
          <div className="free-results">
            <div className="free-head">
              <h3>
                {formatTime(activeSlot.start)}–{formatTime(activeSlot.end)}
              </h3>
              <span className="count-badge">
                {freeCount} free · {busyCount} busy
              </span>
            </div>

            <div className="room-status-list">
              {rooms.map(({ room, classes, busy }) => (
                <article
                  key={room.id}
                  className={`card room-status-card ${busy ? 'busy' : 'free'}`}
                >
                  <div className="row-between">
                    <div className="row-gap">
                      <MapPin size={16} />
                      <strong>{room.name}</strong>
                    </div>
                    <span className={`status-chip ${busy ? 'rejected' : 'accepted'}`}>
                      {busy ? 'Busy' : 'Free'}
                    </span>
                  </div>
                  {busy ? (
                    <ul className="room-busy-meta">
                      {classes.map((e) => (
                        <li key={e.id}>
                          <span>
                            {courseByCode(e.course_code)?.title || e.course_code}
                          </span>
                          <span className="muted">
                            <Users size={12} />{' '}
                            {batchById(e.batch_id)?.name || e.batch_id}
                            {' · '}
                            {teacherByInitial(e.teacher_initial)?.initial ||
                              e.teacher_initial}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">Available this period</p>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}

        {!activeSlot && slots.length > 0 && (
          <div className="empty-state">
            <p>Pick a period to see which rooms are free or busy</p>
          </div>
        )}
      </div>
    </div>
  );
}
