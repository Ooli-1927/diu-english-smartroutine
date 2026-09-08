import { useState } from 'react';
import { Download } from 'lucide-react';
import { useData } from '../context/DataContext';
import {
  exportBatchRoutinePdf,
  exportStudentRoutinePdf,
  exportTeacherRoutinePdf,
  exportTimetablePdf,
} from '../lib/pdf';

type Props =
  | { kind: 'full'; light?: boolean; className?: string; label?: string }
  | {
      kind: 'batch';
      batchId: string;
      section?: string | null;
      light?: boolean;
      className?: string;
      label?: string;
    }
  | {
      kind: 'teacher';
      teacherInitial: string;
      teacherName?: string | null;
      light?: boolean;
      className?: string;
      label?: string;
    }
  | {
      kind: 'student';
      batchId: string;
      section?: string | null;
      studentLabel?: string | null;
      light?: boolean;
      className?: string;
      label?: string;
    };

/** Shared PDF download control for chairman / teacher / student portals. */
export function RoutinePdfButton(props: Props) {
  const { store } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultLabel =
    props.kind === 'full'
      ? 'Full PDF'
      : props.kind === 'batch'
        ? props.section
          ? `Sec ${String(props.section).toUpperCase()} PDF`
          : 'Batch PDF'
        : props.kind === 'student' && props.section
          ? `Download Sec ${String(props.section).toUpperCase()} PDF`
          : props.label || 'Download PDF';

  async function onClick() {
    if (!store || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (props.kind === 'full') {
        await exportTimetablePdf(store, store.timetable, 'DIU English Timetable');
      } else if (props.kind === 'batch') {
        await exportBatchRoutinePdf(store, props.batchId, props.section);
      } else if (props.kind === 'teacher') {
        await exportTeacherRoutinePdf(store, props.teacherInitial, props.teacherName);
      } else {
        await exportStudentRoutinePdf(
          store,
          props.batchId,
          props.section,
          props.studentLabel,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF download failed');
    } finally {
      setBusy(false);
    }
  }

  const studentHasRows =
    props.kind === 'student' &&
    store &&
    store.timetable.some((e) => {
      if (e.batch_id !== props.batchId || e.is_cancelled) return false;
      if (!props.section) return true;
      const sec = String(props.section).trim().toUpperCase();
      const entrySec = String(e.section || e.group_name || '')
        .trim()
        .toUpperCase();
      return !entrySec || entrySec === sec;
    });

  const batchHasRows =
    props.kind === 'batch' &&
    store &&
    store.timetable.some((e) => {
      if (e.batch_id !== props.batchId || e.is_cancelled) return false;
      if (!props.section) return true;
      const sec = String(props.section).trim().toUpperCase();
      const entrySec = String(e.section || e.group_name || '')
        .trim()
        .toUpperCase();
      return !entrySec || entrySec === sec;
    });

  const teacherHasRows =
    props.kind === 'teacher' &&
    store &&
    Boolean(String(props.teacherInitial || '').trim()) &&
    store.timetable.some((e) => {
      const entryInitial = String(e.teacher_initial || '')
        .trim()
        .toUpperCase();
      const want = String(props.teacherInitial || '')
        .trim()
        .toUpperCase();
      return entryInitial === want && !e.is_cancelled;
    });

  const disabled =
    !store ||
    busy ||
    (props.kind === 'batch' && !batchHasRows) ||
    (props.kind === 'teacher' && !teacherHasRows) ||
    (props.kind === 'student' && !studentHasRows) ||
    (props.kind === 'full' && !store.timetable.some((e) => !e.is_cancelled));

  return (
    <div className={`routine-pdf-btn${props.className ? ` ${props.className}` : ''}`}>
      <button
        type="button"
        className={`btn-outline${props.light ? ' calendar-export__btn--light' : ''}`}
        style={{ width: 'auto' }}
        disabled={disabled}
        title={
          disabled && !busy
            ? props.kind === 'teacher'
              ? 'No active classes on your roster to export'
              : 'No active classes to export'
            : props.kind === 'student' && props.section
              ? `Download only Section ${String(props.section).toUpperCase()} routine`
              : props.kind === 'teacher'
                ? 'Download your teaching schedule as PDF'
                : 'Download class routine PDF'
        }
        onClick={() => void onClick()}
      >
        <Download size={16} />
        {busy ? 'Preparing…' : props.label || defaultLabel}
      </button>
      {error ? <p className="muted small error-inline">{error}</p> : null}
    </div>
  );
}
