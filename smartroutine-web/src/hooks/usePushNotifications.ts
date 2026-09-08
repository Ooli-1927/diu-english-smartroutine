import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import {
  detectPushSupport,
  disablePushNotifications,
  enablePushNotifications,
  ensurePushServiceWorker,
  isPushSubscribedLocally,
  PUSH_MODE_EVENT,
  type PushSupport,
} from '../lib/push';
import { api } from '../lib/api';

export type PushUiState =
  | 'offline'
  | 'unsupported'
  | 'insecure'
  | 'server-off'
  | 'denied'
  | 'off'
  | 'on'
  | 'busy';

export function usePushNotifications() {
  const { session } = useAuth();
  const { mode } = useData();
  const [support, setSupport] = useState<PushSupport>(() => detectPushSupport());
  const [serverConfigured, setServerConfigured] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(() => isPushSubscribedLocally());
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLocal = useCallback(() => {
    setSupport(detectPushSupport());
    setSubscribed(isPushSubscribedLocally());
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    refreshLocal();
    const onMode = () => refreshLocal();
    window.addEventListener(PUSH_MODE_EVENT, onMode);
    return () => window.removeEventListener(PUSH_MODE_EVENT, onMode);
  }, [refreshLocal]);

  useEffect(() => {
    if (mode !== 'api' || !session) {
      setServerConfigured(false);
      return;
    }
    let cancelled = false;
    setServerConfigured(null);
    void (async () => {
      try {
        const status = await api.pushStatus();
        if (!cancelled) setServerConfigured(status.configured);
        if (status.configured && detectPushSupport() === 'supported') {
          await ensurePushServiceWorker();
        }
      } catch {
        if (!cancelled) setServerConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, session]);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePushNotifications();
      refreshLocal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enable notifications');
      refreshLocal();
      throw e;
    } finally {
      setBusy(false);
    }
  }, [refreshLocal]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await disablePushNotifications();
      refreshLocal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disable notifications');
      refreshLocal();
    } finally {
      setBusy(false);
    }
  }, [refreshLocal]);

  let ui: PushUiState = 'off';
  if (mode !== 'api' || !session) ui = 'offline';
  else if (busy || serverConfigured === null) ui = 'busy';
  else if (support === 'unsupported') ui = 'unsupported';
  else if (support === 'insecure') ui = 'insecure';
  else if (!serverConfigured) ui = 'server-off';
  else if (permission === 'denied') ui = 'denied';
  else if (permission === 'granted' && subscribed) ui = 'on';
  else ui = 'off';

  return {
    ui,
    support,
    serverConfigured,
    subscribed,
    permission,
    busy,
    error,
    enable,
    disable,
    refreshLocal,
  };
}
