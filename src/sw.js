// Served from the app root (e.g. /driver/sw.js) so its scope covers the whole app.
const APP_SCOPE = self.registration.scope;
const ICON = new URL('assets/icons/icon-192.png', APP_SCOPE).href;
/** Long enough for a driver to feel it in a pocket or on a bike mount. */
const VIBRATION = [500, 200, 500, 200, 500, 200, 900];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Payload sent by the backend: { title, body, orderId, code }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'order-push', orderId: data.orderId });

      // An open page plays its own bell, so the system notification stays quiet to avoid a double alert.
      const watching = windows.some((client) => client.visibilityState === 'visible');

      await self.registration.showNotification(data.title || 'طلب جديد', {
        body: data.body || '',
        icon: ICON,
        badge: ICON,
        tag: data.orderId ? `order-${data.orderId}` : 'new-order',
        renotify: true,
        requireInteraction: true,
        silent: watching,
        vibrate: watching ? undefined : VIBRATION,
        timestamp: Date.now(),
        data: { url: new URL('orders', APP_SCOPE).href },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || new URL('orders', APP_SCOPE).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = windows.find((client) => client.url.startsWith(APP_SCOPE)) || windows[0];
      if (target) return target.focus();
      return self.clients.openWindow(url);
    })()
  );
});
