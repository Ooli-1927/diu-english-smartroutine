import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useData } from '../context/DataContext';
import {
  exportRoutineToCalendar,
  type CalendarLookup,
} from '../lib/calendarExport';
import type { TimetableEntry } from '../lib/types';

type Props = {
  entries: TimetableEntry[];
  audience: 'student' | 'teacher';
  /** Used in the downloaded filename, e.g. batch name or teacher initial */
  fileLabel: string;
  /** Match teacher portal dark hero vs student light buttons */
  light?: boolean;
};

export function CalendarExportButton({ entries, audience, fileLabel, light }: Props) {
  const { courseByCode, teacherByInitial, batchById, roomById } = useData();
  const [error, setError] = useState<string | null>(null);

  const activeCount = entries.filter((e) => !e.is_cancelled).length;

  function onExport() {
    setError(null);
    try {
      const lookup: CalendarLookup = {
        courseByCode,
        teacherByInitial,
        batchById,
        roomById,
      };
      exportRoutineToCalendar(entries, audience, fileLabel || audience, lookup);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export calendar');
    }
  }

  return (
    <div className="calendar-export">
      <button
        type="button"
        className={`btn-outline${light ? ' calendar-export__btn--light' : ''}`}
        style={{ width: 'auto' }}
        disabled={activeCount === 0}
        title={
          activeCount === 0
            ? 'No active classes to export'
            : 'Download weekly class schedule as .ics'
        }
        onClick={onExport}
      >
        <CalendarPlus size={16} /> Export to Calendar
      </button>
      <p className="muted small calendar-export__hint">
        Import this file into Google Calendar, Outlook, or Apple Calendar to sync your class
        schedule.
      </p>
      <p className="muted small calendar-export__hint">
        Recurring weekly — remove manually from your calendar app at the end of the semester.
      </p>
      {error && <p className="error small calendar-export__error">{error}</p>}
    </div>
  );
}
