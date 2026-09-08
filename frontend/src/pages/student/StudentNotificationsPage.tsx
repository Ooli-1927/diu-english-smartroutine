import { CheckCheck } from 'lucide-react';
import { PageHero } from '../../components/PageHero';
import { NotificationList } from '../../components/NotificationList';
import { PushNotificationBanner } from '../../components/PushNotificationBanner';
import { useNotifications } from '../../hooks/useNotifications';

export function StudentNotificationsPage() {
  const { items, unread, loading, error, markRead, markAllRead } = useNotifications();

  return (
    <div className="page">
      <PageHero
        variant="page"
        kicker="Inbox"
        title="Notifications"
        actions={
          unread > 0 ? (
            <button className="link-btn" onClick={() => void markAllRead()}>
              <CheckCheck size={16} /> Mark all read
            </button>
          ) : undefined
        }
      />
      <PushNotificationBanner />
      <NotificationList
        items={items}
        loading={loading}
        error={error}
        emptyText="No class updates for your batch yet"
        onMarkRead={(id) => void markRead(id)}
        hrefFor={(n) =>
          n.type === 'appointment' ? '/student/appointments' : null
        }
      />
    </div>
  );
}
