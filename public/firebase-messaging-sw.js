// Firebase Cloud Messaging Background Service Worker for 1 social
// Handles background push notifications when the app is in background or closed

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Minimal public app config (no secrets or service accounts)
const firebaseConfig = {
  projectId: "autonomous-technique-mnm8c",
  appId: "1:123885793660:web:f4ac6f6c43e46f840974f9",
  apiKey: "AIzaSyDxh1Itz3NAc2fiNVHN7vJBWy_GTIFaDqw",
  messagingSenderId: "123885793660",
};

try {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message: ', payload);

    const notificationTitle = payload.notification?.title || payload.data?.title || '1 social';
    const notificationOptions = {
      body: payload.notification?.body || payload.data?.body || 'New notification in 1 social',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.data?.tag || '1social-notification',
      data: {
        url: payload.data?.url || '/',
        type: payload.data?.type || 'general',
      },
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (e) {
  console.warn('Firebase Messaging in worker initialization notice:', e);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
