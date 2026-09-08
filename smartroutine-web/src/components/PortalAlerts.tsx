import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';
import { PushNotificationToggle } from './PushNotificationToggle';

type Props = {
  noticesTo: string;
  /** Icons on a dark bar (student/teacher hero, chairman sidebar). */
  tone?: 'on-dark' | 'on-light';
};

/** Same push + inbox bells used on student, teacher, and chairman chrome. */
export function PortalAlerts({ noticesTo, tone = 'on-dark' }: Props) {
  const { unread } = useNotifications();
  const light = tone === 'on-light';
  const label = unread > 0 ? `${unread} unread notifications` : 'Notifications';

  return (
    <div className="portal-alerts">
      <PushNotificationToggle light={light} />
      <Link
        to={noticesTo}
        className={`hero-icon-btn bell${light ? ' light' : ''}`}
        title="Notifications"
        aria-label={label}
      >
        <Bell size={18} />
        {unread > 0 ? <span className="bell-badge">{unread > 9 ? '9+' : unread}</span> : null}
      </Link>
    </div>
  );
}
