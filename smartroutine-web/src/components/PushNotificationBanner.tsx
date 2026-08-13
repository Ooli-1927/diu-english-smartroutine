import { PushNotificationToggle } from './PushNotificationToggle';
import { usePushNotifications } from '../hooks/usePushNotifications';

/** Short prompt on inbox pages explaining the push toggle. */
export function PushNotificationBanner() {
  const { ui } = usePushNotifications();

  if (ui === 'offline' || ui === 'unsupported' || ui === 'insecure') {
    return (
      <p className="muted small push-banner">
        Browser push is unavailable here — the inbox still refreshes about every minute.
      </p>
    );
  }

  if (ui === 'server-off') {
    return (
      <p className="muted small push-banner">
        Push is not configured on the server yet (set VAPID keys). Inbox polling stays active.
      </p>
    );
  }

  if (ui === 'denied') {
    return (
      <p className="muted small push-banner">
        Notifications are blocked in your browser settings — inbox polling every minute still works.
      </p>
    );
  }

  if (ui === 'on') {
    return (
      <div className="push-banner row-gap">
        <PushNotificationToggle light />
        <p className="muted small" style={{ margin: 0 }}>
          Push notifications are on. Inbox still checks every 5 minutes as a backup.
        </p>
      </div>
    );
  }

  return (
    <div className="push-banner row-gap">
      <PushNotificationToggle light />
      <p className="muted small" style={{ margin: 0 }}>
        Enable notifications for instant class updates (cancel / reschedule / appointments).
      </p>
    </div>
  );
}
