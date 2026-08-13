import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { AppNotification } from '../lib/types';
import {
  getNotificationPollMs,
  PUSH_MODE_EVENT,
  PUSH_REFRESH_EVENT,
} from '../lib/push';

const READ_KEY = 'diu_read_notifications';

function readLocalReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * Offline mode has no notification table, so cancelled classes are turned into
 * the same shape the API returns and "read" state is kept in the browser.
 * No API polling and no server delivery is invented in offline mode.
 */
function derivedNotifications(
  timetable: {
    id: string;
    day: string;
    course_code: string;
    batch_id: string;
    teacher_initial: string;
    is_cancelled: boolean;
    cancellation_reason: string | null;
  }[],
  audience: { type: 'student' | 'teacher' | 'super_admin'; id: string },
  readIds: Set<string>,
): AppNotification[] {
  return timetable
    .filter((e) => e.is_cancelled)
    .filter((e) => {
      if (audience.type === 'super_admin') return true;
      if (audience.type === 'student') return e.batch_id === audience.id;
      return e.teacher_initial === audience.id;
    })
    .map((e) => ({
      id: `local_${e.id}`,
      type: 'class_cancelled',
      title: 'Class cancelled',
      body: `${e.course_code} on ${e.day} — ${e.cancellation_reason || 'no reason given'}`,
      recipient_type: audience.type,
      recipient_id: audience.id,
      related_entry_id: e.id,
      is_read: readIds.has(`local_${e.id}`),
      created_at: '',
    }));
}

export function useNotifications() {
  const { session } = useAuth();
  const { mode, store } = useData();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(() => readLocalReadIds());
  const [pollMs, setPollMs] = useState(() => getNotificationPollMs());

  const isApi = mode === 'api';

  const audience = useMemo(() => {
    if (!session) return null;
    if (session.role === 'super_admin') return { type: 'super_admin' as const, id: session.id };
    if (session.role === 'student') {
      return { type: 'student' as const, id: session.batchId || '' };
    }
    return { type: 'teacher' as const, id: session.teacherInitial || '' };
  }, [session]);

  const refresh = useCallback(async () => {
    if (!session || !audience) return;
    if (!isApi) {
      setItems(derivedNotifications(store?.timetable || [], audience, localReadIds));
      setLoading(false);
      return;
    }
    try {
      setItems(await api.notifications());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notifications');
    } finally {
      setLoading(false);
    }
  }, [session, audience, isApi, store, localReadIds]);

  useEffect(() => {
    const syncPoll = () => setPollMs(getNotificationPollMs());
    syncPoll();
    window.addEventListener(PUSH_MODE_EVENT, syncPoll);
    return () => window.removeEventListener(PUSH_MODE_EVENT, syncPoll);
  }, []);

  useEffect(() => {
    void refresh();
    if (!isApi) return;

    const timer = window.setInterval(() => void refresh(), pollMs);

    const onRefresh = () => void refresh();
    window.addEventListener(PUSH_REFRESH_EVENT, onRefresh);

    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_NOTIFICATION') onRefresh();
    };
    navigator.serviceWorker?.addEventListener('message', onSwMessage);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(PUSH_REFRESH_EVENT, onRefresh);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [refresh, isApi, pollMs]);

  const markRead = useCallback(
    async (id: string) => {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      if (isApi) {
        await api.markNotificationRead(id);
        return;
      }
      setLocalReadIds((prev) => {
        const next = new Set(prev).add(id);
        localStorage.setItem(READ_KEY, JSON.stringify([...next]));
        return next;
      });
    },
    [isApi],
  );

  const markAllRead = useCallback(async () => {
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id);
    for (const id of unreadIds) await markRead(id);
  }, [items, markRead]);

  const unread = items.filter((n) => !n.is_read).length;

  return { items, unread, loading, error, refresh, markRead, markAllRead, pollMs };
}
