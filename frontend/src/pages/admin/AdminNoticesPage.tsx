import { useMemo, useState } from 'react';
import { CheckCheck, RefreshCw } from 'lucide-react';
import { NotificationList } from '../../components/NotificationList';
import { PageHero } from '../../components/PageHero';
import { PushNotificationBanner } from '../../components/PushNotificationBanner';
import { useNotifications } from '../../hooks/useNotifications';

const audiences = ['all', 'student', 'teacher'] as const;

export function AdminNoticesPage() {
  const { items, unread, loading, error, refresh, markRead, markAllRead } = useNotifications();
  const [audience, setAudience] = useState<(typeof audiences)[number]>('all');

  const visible = useMemo(
    () => (audience === 'all' ? items : items.filter((n) => n.recipient_type === audience)),
    [items, audience],
  );

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="Comms · Broadcast"
        title="Notices"
        subtitle="Class changes and broadcast messages for students and faculty."
        actions={
          <div className="page-actions">
            <button className="btn-outline" onClick={() => void refresh()}>
              <RefreshCw size={16} /> Refresh
            </button>
            {unread > 0 && (
              <button className="btn-outline" onClick={() => void markAllRead()}>
                <CheckCheck size={16} /> Mark all read
              </button>
            )}
          </div>
        }
      />

      <PushNotificationBanner />

      <div className="day-pills dark">
        {audiences.map((a) => (
          <button key={a} className={audience === a ? 'active' : ''} onClick={() => setAudience(a)}>
            {a === 'all' ? 'All' : `${a}s`}
          </button>
        ))}
      </div>

      <NotificationList
        items={visible}
        loading={loading}
        error={error}
        emptyText="Class changes will show up here"
        onMarkRead={(id) => void markRead(id)}
      />
    </div>
  );
}
