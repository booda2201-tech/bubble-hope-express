// Served from the app root (e.g. /driver/sw.js) so its scope covers the whole app.
const APP_SCOPE = self.registration.scope;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = windows.find((client) => client.url.startsWith(APP_SCOPE)) || windows[0];
      if (target) return target.focus();
      return self.clients.openWindow(new URL('orders', APP_SCOPE).href);
    })()
  );
});
