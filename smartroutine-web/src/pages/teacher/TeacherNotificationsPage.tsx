import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCheck } from 'lucide-react';
import { NotificationList } from '../../components/NotificationList';
import { PushNotificationBanner } from '../../components/PushNotificationBanner';
import { BrandMark } from '../../components/BrandMark';
import { useNotifications } from '../../hooks/useNotifications';

export function TeacherNotificationsPage() {
  const { items, unread, loading, error, markRead, markAllRead } = useNotifications();

  return (
    <>
      <header className="teacher-hero compact">
        <div className="row-between">
          <div className="row-gap topbar-brand">
            <Link to="/teacher" className="hero-icon-btn">
              <ArrowLeft size={18} />
            </Link>
            <BrandMark variant="compact" title="Notifications" subtitle="DIU · Department of English" />
          </div>
          {unread > 0 && (
            <button className="hero-icon-btn" title="Mark all read" onClick={() => void markAllRead()}>
              <CheckCheck size={18} />
            </button>
          )}
        </div>
      </header>
      <div className="page-content pad-top">
        <PushNotificationBanner />
        <NotificationList
          items={items}
          loading={loading}
          error={error}
          emptyText="No updates on your classes yet"
          onMarkRead={(id) => void markRead(id)}
          hrefFor={(n) =>
            n.type === 'appointment' ? '/teacher/appointments' : null
          }
        />
      </div>
    </>
  );
}
