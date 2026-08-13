import { useMemo, useState } from 'react';
import { School } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { PageHero } from '../../components/PageHero';
import { ScheduleCard } from '../../components/ScheduleCard';
import { CalendarExportButton } from '../../components/CalendarExportButton';
import { DAYS, todayDay } from '../../lib/constants';
import type { DayCode } from '../../lib/types';

export function StudentSchedulePage() {
  const { session } = useAuth();
  const { store, batchById } = useData();
  const [day, setDay] = useState<DayCode>(todayDay());

  const batchId = session?.batchId || '';
  const batch = batchById(batchId);
  const today = todayDay();

  const weekEntries = useMemo(() => {
    if (!store || !batchId) return [];
    return store.timetable.filter((e) => e.batch_id === batchId);
  }, [store, batchId]);

  const entries = useMemo(() => {
    return weekEntries
      .filter((e) => e.day === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [weekEntries, day]);

  return (
    <div className="page">
      <PageHero
        variant="page"
        kicker="Your week"
        title="My Schedule"
        icon={<School size={22} color="#fff" />}
        subtitle={
          <>
            {batch?.name || batchId || 'Your batch'}
            {batch?.session ? ` · ${batch.session}` : ''}
            {day === today ? ` · Today` : ''}
          </>
        }
        trailing={<span className="online-dot">Online</span>}
      />

      {batchId ? (
        <CalendarExportButton
          light
          audience="student"
          entries={weekEntries}
          fileLabel={batch?.name || batchId}
        />
      ) : null}

      <div className="day-pills dark">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            className={day === d ? 'active' : ''}
            onClick={() => setDay(d)}
          >
            {d}
            {d === today ? ' ·' : ''}
          </button>
        ))}
      </div>

      <div className="page-content">
        {!batchId && (
          <div className="empty-state error">
            <p>Your account is not linked to a batch. Ask an admin to set your batch.</p>
          </div>
        )}
        {batchId && entries.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">
              <School size={40} />
            </div>
            <p>No classes on {day} for {batch?.name || batchId}</p>
          </div>
        )}
        {entries.map((e) => (
          <ScheduleCard key={e.id} entry={e} showBatch={false} />
        ))}
      </div>
    </div>
  );
}
