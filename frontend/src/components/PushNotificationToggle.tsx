import { BellOff, BellRing } from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';

type Props = {
  /** Match student topbar light icon buttons */
  light?: boolean;
};

function titleFor(ui: ReturnType<typeof usePushNotifications>['ui']): string {
  switch (ui) {
    case 'on':
      return 'Disable push notifications';
    case 'off':
      return 'Enable notifications';
    case 'denied':
      return 'Notifications blocked in browser settings';
    case 'unsupported':
      return 'Push notifications are not supported here';
    case 'insecure':
      return 'Push requires HTTPS (or localhost)';
    case 'server-off':
      return 'Push is not configured on the server (VAPID keys)';
    case 'offline':
      return 'Push needs Live API mode';
    case 'busy':
      return 'Updating notification settings…';
    default:
      return 'Notifications';
  }
}

/** Bell toggle: enable/disable browser push (falls back to polling when off/unsupported). */
export function PushNotificationToggle({ light }: Props) {
  const { ui, enable, disable, busy } = usePushNotifications();

  if (ui === 'offline') return null;

  const enabled = ui === 'on';
  const disabled =
    busy || ui === 'unsupported' || ui === 'insecure' || ui === 'server-off' || ui === 'denied';

  return (
    <button
      type="button"
      className={`hero-icon-btn ${light ? 'light' : ''} ${enabled ? 'push-on' : ''}`}
      title={titleFor(ui)}
      aria-label={titleFor(ui)}
      aria-pressed={enabled}
      disabled={disabled}
      onClick={() => {
        if (enabled) void disable();
        else void enable().catch(() => undefined);
      }}
    >
      {enabled ? <BellRing size={18} /> : <BellOff size={18} />}
    </button>
  );
}
