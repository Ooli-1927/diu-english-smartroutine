import { useMemo, useState } from 'react';
import { School } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { PageHero } from '../../components/PageHero';
import { ScheduleCard } from '../../components/ScheduleCard';
import { CalendarExportButton } from '../../components/CalendarExportButton';
import { RoutinePdfButton } from '../../components/RoutinePdfButton';
import { DAYS, todayDay } from '../../lib/constants';
import { filterBatchSectionEntries } from '../../lib/pdf';
import type { DayCode } from '../../lib/types';

export function StudentSchedulePage() {
  const { session } = useAuth();
  const { store, batchById } = useData();
  const [day, setDay] = useState<DayCode>(todayDay());

  const batchId = session?.batchId || '';
  const section = session?.section?.trim().toUpperCase() || null;
  const batch = batchById(batchId);
  const today = todayDay();

  const weekEntries = useMemo(() => {
    if (!store || !batchId) return [];
    return filterBatchSectionEntries(store.timetable, batchId, section);
  }, [store, batchId, section]);

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
            {section ? ` · Section ${section}` : ''}
            {batch?.session ? ` · ${batch.session}` : ''}
            {day === today ? ` · Today` : ''}
          </>
        }
        trailing={<span className="online-dot">Online</span>}
      />

      {batchId ? (
        <div className="schedule-export-row">
          <RoutinePdfButton
            kind="student"
            batchId={batchId}
            section={section}
            studentLabel={session?.name || null}
            light
            label={section ? `Download Sec ${section} PDF` : 'Download PDF'}
          />
          <CalendarExportButton
            light
            audience="student"
            entries={weekEntries}
            fileLabel={
              section
                ? `${batch?.name || batchId}_Sec_${section}`
                : batch?.name || batchId
            }
          />
        </div>
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
        {batchId && !section && (
          <div className="warn-banner" style={{ marginBottom: '0.75rem' }}>
            <p>
              Your account has no section set. PDF will include the whole batch — ask an admin to
              assign your section (A/B).
            </p>
          </div>
        )}
        {batchId && entries.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">
              <School size={40} />
            </div>
            <p>
              No classes on {day} for {batch?.name || batchId}
              {section ? ` · Sec ${section}` : ''}
            </p>
          </div>
        )}
        {entries.map((e) => (
          <ScheduleCard key={e.id} entry={e} showBatch={false} />
        ))}
      </div>
    </div>
  );
}
