import { useNavigate } from 'react-router-dom';
import {
  BellRing,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  DoorOpen,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { AppNotification } from '../lib/types';

const icons: Record<string, typeof BellRing> = {
  class_cancelled: XCircle,
  class_restored: CheckCircle2,
  class_rescheduled: CalendarClock,
  class_assigned: CalendarPlus,
  class_removed: Trash2,
  room_changed: DoorOpen,
  appointment: BellRing,
};

/** SQLite stores UTC without a zone marker, so it is made explicit before parsing. */
function formatWhen(value: string) {
  if (!value) return '';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)}h ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

interface Props {
  items: AppNotification[];
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  onMarkRead?: (id: string) => void;
  /** Where tapping a notification should go — e.g. appointment → appointments page. */
  hrefFor?: (n: AppNotification) => string | null;
}

export function NotificationList({
  items,
  loading,
  error,
  emptyText = 'No notifications yet',
  onMarkRead,
  hrefFor,
}: Props) {
  const navigate = useNavigate();

  if (loading) return <div className="empty-state">Loading notifications…</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!items.length) return <div className="empty-state">{emptyText}</div>;

  function open(n: AppNotification) {
    const href = hrefFor?.(n) || null;
    if (!href) return;
    if (!n.is_read && onMarkRead) onMarkRead(n.id);
    navigate(href);
  }

  return (
    <div className="notification-list">
      {items.map((n) => {
        const Icon = icons[n.type] || BellRing;
        const href = hrefFor?.(n) || null;
        const clickable = Boolean(href);

        return (
          <article
            key={n.id}
            className={`notification-item ${n.is_read ? '' : 'unread'} ${
              clickable ? 'clickable' : ''
            }`}
            role={clickable ? 'link' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={() => {
              if (clickable) open(n);
            }}
            onKeyDown={(e) => {
              if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                open(n);
              }
            }}
          >
            <div className={`notification-icon ${n.type}`}>
              <Icon size={18} />
            </div>
            <div className="notification-body">
              <div className="row-between">
                <strong>{n.title}</strong>
                <span className="muted small">{formatWhen(n.created_at)}</span>
              </div>
              <p className="muted">{n.body}</p>
              {clickable && <span className="notification-go">Open appointments →</span>}
            </div>
            {!n.is_read && onMarkRead && (
              <button
                className="link-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkRead(n.id);
                }}
                title="Mark as read"
              >
                Mark read
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
