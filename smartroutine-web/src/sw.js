/* Combined PWA + Web Push service worker (injectManifest).
 * Vite PWA injects self.__WB_MANIFEST at build time. */

import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// App shell only — built JS/CSS/HTML/icons. Never caches /api responses.
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api/, /^\/data\//],
  }),
);

self.addEventListener('push', (event) => {
  let data = {
    title: 'DIU SmartRoutine',
    body: 'You have a new update',
    url: '/',
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch {
    try {
      const text = event.data?.text?.();
      if (text) data.body = text;
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'DIU SmartRoutine', {
        body: data.body || 'You have a new update',
        icon: '/icons/pwa-192.png',
        badge: '/icons/pwa-192.png',
        data: { url: data.url || '/' },
        tag: data.type || 'notice',
        renotify: true,
      }),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: 'PUSH_NOTIFICATION', payload: data });
        }
      }),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) {
            try {
              client.navigate(targetUrl);
            } catch {
              /* older browsers */
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
