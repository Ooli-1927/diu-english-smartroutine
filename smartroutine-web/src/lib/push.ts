import { api } from './api';

export const PUSH_MODE_EVENT = 'diu-push-mode-changed';
export const PUSH_REFRESH_EVENT = 'diu-push-refresh';

const SUBSCRIBED_KEY = 'diu_push_subscribed';

export const POLL_MS_ACTIVE = 60_000;
export const POLL_MS_PUSH_FALLBACK = 5 * 60_000;

export type PushSupport = 'supported' | 'unsupported' | 'insecure';

export function detectPushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  return 'supported';
}

export function isPushSubscribedLocally(): boolean {
  try {
    return localStorage.getItem(SUBSCRIBED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPushSubscribedLocally(on: boolean) {
  try {
    if (on) localStorage.setItem(SUBSCRIBED_KEY, '1');
    else localStorage.removeItem(SUBSCRIBED_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(PUSH_MODE_EVENT));
}

/** When push is active, poll slowly as a silent fallback; otherwise keep the 60s inbox poll. */
export function getNotificationPollMs(): number {
  if (detectPushSupport() !== 'supported') return POLL_MS_ACTIVE;
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return POLL_MS_ACTIVE;
  }
  if (Notification.permission === 'granted' && isPushSubscribedLocally()) {
    return POLL_MS_PUSH_FALLBACK;
  }
  return POLL_MS_ACTIVE;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Same SW as vite-plugin-pwa (`/sw.js` with push + precache).
 * Prefer an existing registration so we never register two workers.
 */
export async function ensurePushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (detectPushSupport() !== 'supported') return null;
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function enablePushNotifications(): Promise<void> {
  if (detectPushSupport() !== 'supported') {
    throw new Error('Push notifications are not supported in this browser');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    setPushSubscribedLocally(false);
    throw new Error('Notification permission was not granted');
  }

  const { publicKey } = await api.pushVapidPublicKey();
  const registration = await ensurePushServiceWorker();
  if (!registration) throw new Error('Could not register service worker');

  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const json = subscription.toJSON();
  await api.pushSubscribe({
    endpoint: json.endpoint!,
    keys: {
      p256dh: json.keys!.p256dh!,
      auth: json.keys!.auth!,
    },
  });

  setPushSubscribedLocally(true);
}

export async function disablePushNotifications(): Promise<void> {
  const registration =
    detectPushSupport() === 'supported'
      ? await navigator.serviceWorker.getRegistration('/')
      : null;

  const subscription = await registration?.pushManager.getSubscription();
  const endpoint = subscription?.endpoint;

  try {
    await api.pushUnsubscribe(endpoint);
  } catch {
    /* still clear locally */
  }

  if (subscription) {
    try {
      await subscription.unsubscribe();
    } catch {
      /* ignore */
    }
  }

  setPushSubscribedLocally(false);
}
