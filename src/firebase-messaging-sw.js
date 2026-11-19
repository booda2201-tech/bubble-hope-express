/* Firebase background handler. Must live next to index.html or closed-tab notifications never appear. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/* Registered before Firebase so this handler reads the push and still runs after every tab is closed. */
self.addEventListener('push', (event) => {
  event.stopImmediatePropagation();
  const payload = event.data ? event.data.json().catch(() => ({})) : Promise.resolve({});
  event.waitUntil(payload.then(present));
});

firebase.initializeApp({
  apiKey: 'AIzaSyCQd1D6NbL4CUhEJiiIsDj31zLyZTCcy0U',
  authDomain: 'bubblehope-53b8f.firebaseapp.com',
  projectId: 'bubblehope-53b8f',
  storageBucket: 'bubblehope-53b8f.appspot.com',
  messagingSenderId: '537902604580',
  appId: '1:537902604580:web:6052b8e7425c567c4613b1',
});

firebase.messaging();

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || new URL('orders', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const target = windows.find((client) => client.url.indexOf(self.registration.scope) === 0) || windows[0];
      if (target) return target.focus();
      return self.clients.openWindow(url);
    })
  );
});

function present(payload) {
  const data = payload.data || {};
  const notification = payload.notification || {};
  const title = notification.title || data.title || 'طلب جديد';
  const body = notification.body || data.body || '';
  const orderId = data.orderId || '';

  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      client.postMessage({ type: 'order-push', orderId: orderId, title: title, body: body });
    }
    const icon = new URL('assets/icons/icon-192.png', self.registration.scope).href;
    return self.registration.showNotification(title, {
      body: body,
      icon: icon,
      badge: icon,
      tag: orderId ? 'order-' + orderId : 'new-order',
      renotify: true,
      requireInteraction: true,
      data: { url: new URL('orders', self.registration.scope).href, orderId: orderId },
    });
  });
}
