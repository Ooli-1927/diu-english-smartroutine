import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarRange, CheckCircle2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { findConflicts, summarizeConflicts } from '../../lib/conflicts';
import { DAYS } from '../../lib/constants';
import type { DayCode } from '../../lib/types';
import { ConflictPanel } from '../../components/ConflictPanel';
import { PageHero } from '../../components/PageHero';

export function AdminConflictsPage() {
  const { store } = useData();
  const conflicts = useMemo(() => findConflicts(store?.timetable || []), [store]);
  const summary = summarizeConflicts(conflicts);
  const daysWithClashes = useMemo(() => {
    const set = new Set(conflicts.map((c) => c.day));
    return DAYS.filter((d) => set.has(d));
  }, [conflicts]);
  const [day, setDay] = useState<DayCode | 'All'>('All');

  // If the selected day no longer has clashes, fall back to All
  useEffect(() => {
    if (day !== 'All' && !daysWithClashes.includes(day)) {
      setDay('All');
    }
  }, [day, daysWithClashes]);

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="Operations · Routine health"
        title="Conflict checker"
        subtitle="Pick a clash day to focus — or All to see only the days that actually have clashes."
        actions={
          <div className="page-actions">
            <Link className="btn-outline" to="/admin/timetable">
              <CalendarRange size={16} /> Timetable
            </Link>
          </div>
        }
      />

      <section className={`card pad conflict-summary ${summary.total ? 'warn' : 'ok'}`}>
        <div className="conflict-summary__icon">
          {summary.total ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
        </div>
        <div>
          <strong>
            {summary.total
              ? `${summary.total} clash${summary.total === 1 ? '' : 'es'} on ${daysWithClashes.length} day${
                  daysWithClashes.length === 1 ? '' : 's'
                } (${daysWithClashes.join(', ')})`
              : 'Routine is clean'}
          </strong>
          <p className="muted">
            {summary.total
              ? [
                  summary.room ? `${summary.room} room` : '',
                  summary.teacher ? `${summary.teacher} teacher` : '',
                  summary.batch ? `${summary.batch} batch` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No room, teacher or batch overlaps right now.'}
          </p>
        </div>
      </section>

      {daysWithClashes.length > 0 && (
        <div className="day-pills dark">
          <button
            type="button"
            className={day === 'All' ? 'active' : ''}
            onClick={() => setDay('All')}
          >
            All
          </button>
          {daysWithClashes.map((d) => (
            <button
              key={d}
              type="button"
              className={day === d ? 'active' : ''}
              onClick={() => setDay(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      <ConflictPanel conflicts={conflicts} title="Conflicts" forceOpen dayFilter={day} />
    </div>
  );
}
