self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = windows.find((client) => client.url.includes('/orders')) || windows[0];
      if (target) return target.focus();
      return self.clients.openWindow('/orders');
    })()
  );
});
