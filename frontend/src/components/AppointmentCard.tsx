import type { ReactNode } from 'react';
import { CalendarDays, Clock, MessageSquare, User } from 'lucide-react';
import type { Appointment } from '../lib/types';
import { appointmentStatusLabel } from '../lib/types';

interface Props {
  appointment: Appointment;
  audience: 'student' | 'teacher';
  actions?: ReactNode;
}

export function AppointmentCard({ appointment, audience, actions }: Props) {
  const who =
    audience === 'student'
      ? `Teacher ${appointment.teacher_initial}`
      : `${appointment.student_name} (${appointment.student_id})`;

  return (
    <article className="card pad appointment-card">
      <div className="row-between">
        <div className="row-gap">
          <User size={16} />
          <strong>{who}</strong>
        </div>
        <span className={`status-chip ${appointment.status}`}>
          {appointmentStatusLabel(appointment.status)}
        </span>
      </div>
      <div className="row-gap muted wrap">
        <span className="row-gap">
          <CalendarDays size={14} /> {appointment.date}
        </span>
        <span className="row-gap">
          <Clock size={14} /> {appointment.time}
        </span>
      </div>
      {appointment.purpose && <p className="muted">{appointment.purpose}</p>}
      {appointment.teacher_remarks && (
        <p className="row-gap muted">
          <MessageSquare size={14} /> {appointment.teacher_remarks}
        </p>
      )}
      {actions}
    </article>
  );
}
