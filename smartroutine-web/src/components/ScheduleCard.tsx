import type { ReactNode } from 'react';
import type { TimetableEntry } from '../lib/types';
import { formatTime } from '../lib/constants';
import { useData } from '../context/DataContext';
import { AlertTriangle, MapPin, User, Users, Wifi } from 'lucide-react';

interface Props {
  entry: TimetableEntry;
  showBatch?: boolean;
  showTeacher?: boolean;
  actions?: ReactNode;
  warning?: string;
}

export function ScheduleCard({
  entry,
  showBatch = true,
  showTeacher = true,
  actions,
  warning,
}: Props) {
  const { courseByCode, teacherByInitial, batchById, roomById } = useData();
  const course = courseByCode(entry.course_code);
  const teacher = teacherByInitial(entry.teacher_initial);
  const batch = batchById(entry.batch_id);
  const room = roomById(entry.room_id);
  const online = entry.mode === 'Online';

  return (
    <article
      className={`schedule-card ${entry.is_cancelled ? 'cancelled' : ''} ${
        warning && !entry.is_cancelled ? 'clashing' : ''
      }`}
    >
      <div className="schedule-card__top">
        <h3 className={entry.is_cancelled ? 'strike' : ''}>
          {course?.title || entry.course_code}
        </h3>
        <span className="time-badge">
          {formatTime(entry.start_time)} – {formatTime(entry.end_time)}
        </span>
      </div>
      <p className="muted code-line">{entry.course_code} · {entry.type}</p>
      <div className="chip-row">
        {showTeacher && (
          <span className="chip">
            <User size={14} /> {teacher?.name || entry.teacher_initial}
          </span>
        )}
        {showBatch && (
          <span className="chip">
            <Users size={14} /> {batch?.name || entry.batch_id}
          </span>
        )}
        <span className={`chip ${online ? 'chip-online' : ''}`}>
          {online ? <Wifi size={14} /> : <MapPin size={14} />}
          {online ? 'Online' : room?.name || entry.room_id || 'TBA'}
        </span>
        {entry.group_name && <span className="chip">{entry.group_name}</span>}
      </div>
      {warning && !entry.is_cancelled && (
        <div className="clash-banner">
          <AlertTriangle size={14} /> {warning}
        </div>
      )}
      {entry.is_cancelled && (
        <div className="cancel-banner">
          CANCELLED
          {entry.cancellation_reason ? ` — ${entry.cancellation_reason}` : ''}
        </div>
      )}
      {actions && <div className="schedule-card__actions">{actions}</div>}
    </article>
  );
}
