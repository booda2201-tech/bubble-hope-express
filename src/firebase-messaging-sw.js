/* Firebase background handler. Must live next to index.html or closed-tab notifications never appear. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCQd1D6NbL4CUhEJiiIsDj31zLyZTCcy0U',
  authDomain: 'bubblehope-53b8f.firebaseapp.com',
  projectId: 'bubblehope-53b8f',
  storageBucket: 'bubblehope-53b8f.appspot.com',
  messagingSenderId: '537902604580',
  appId: '1:537902604580:web:6052b8e7425c567c4613b1',
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const messaging = firebase.messaging();
const ICON = new URL('assets/icons/icon-192.png', self.registration.scope).href;
const VIBRATION = [500, 200, 500, 200, 500, 200, 900];

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = (payload.notification && payload.notification.title) || 'طلب جديد';
  const body = (payload.notification && payload.notification.body) || '';

  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) client.postMessage({ type: 'order-push', orderId: data.orderId });
    if (windows.some((client) => client.visibilityState === 'visible')) return undefined;
    return self.registration.showNotification(title, {
      body,
      icon: ICON,
      badge: ICON,
      tag: data.orderId ? 'order-' + data.orderId : 'new-order',
      renotify: true,
      requireInteraction: true,
      vibrate: VIBRATION,
      data: { url: new URL('orders', self.registration.scope).href },
    });
  });
});

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
