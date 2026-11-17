// Firebase Cloud Messaging Background Service Worker for 1 social
// Handles background incoming Audio & Video Call notifications on Android PWA & Desktop

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Minimal public app config (no private keys or service accounts)
const firebaseConfig = {
  projectId: "autonomous-technique-mnm8c",
  appId: "1:123885793660:web:f4ac6f6c43e46f840974f9",
  apiKey: "AIzaSyDxh1Itz3NAc2fiNVHN7vJBWy_GTIFaDqw",
  messagingSenderId: "123885793660",
};

let messaging = null;

try {
  if (firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
  }
  messaging = firebase.messaging();
} catch (e) {
  console.warn('[firebase-messaging-sw.js] Firebase initialization notice:', e);
}

/**
 * Handles incoming background call notification display and cancellation
 */
async function handleIncomingCallPayload(data) {
  if (!data) return;

  const callId = data.callId || data.id;
  const status = data.status;

  // Case 1: Call cancelled or ended -> dismiss active notification immediately
  if (status === 'ended' || status === 'rejected' || status === 'cancelled' || status === 'missed') {
    if (callId && self.registration?.getNotifications) {
      const activeNotifications = await self.registration.getNotifications({ tag: `call-${callId}` });
      for (const notif of activeNotifications) {
        notif.close();
      }
    }
    return;
  }

  // Case 2: Incoming call ringing
  const callerName = data.callerName || 'Someone';
  const callerUsername = data.callerUsername ? `@${data.callerUsername}` : '';
  const callType = data.callType || data.type || 'audio';
  const isVideo = callType === 'video';
  const callerPhoto = data.callerPhoto || '/icon-192.png';

  const title = `Incoming ${isVideo ? 'Video' : 'Audio'} Call`;
  const body = `${callerName} ${callerUsername ? `(${callerUsername}) ` : ''}is calling you on 1 social...`;

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    image: callerPhoto.startsWith('http') ? callerPhoto : undefined,
    tag: `call-${callId}`, // Prevents duplicate notifications for the same call
    renotify: true,
    requireInteraction: true, // Keeps notification persistent on Android screen until answered
    vibrate: [300, 150, 300, 150, 300, 150, 600, 200, 600],
    timestamp: Date.now(),
    data: {
      callId,
      callType,
      callerId: data.callerId,
      callerName,
      url: `/?callId=${callId}&action=accept`,
    },
    actions: [
      {
        action: 'accept',
        title: '📞 Accept',
      },
      {
        action: 'decline',
        title: '❌ Decline',
      },
    ],
  };

  return self.registration.showNotification(title, options);
}

// 1. Firebase Messaging SDK Background Handler
if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] onBackgroundMessage received:', payload);
    const data = payload.data || {};
    return handleIncomingCallPayload(data);
  });
}

// 2. Direct Raw Push Event Fallback (guarantees push works even if SDK compat delays)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const raw = event.data.json();
    const data = raw.data || raw;
    if (data && (data.callId || data.type === 'incoming_call')) {
      event.waitUntil(handleIncomingCallPayload(data));
    }
  } catch (e) {
    // Non-JSON push payload
  }
});

// 3. Notification Click / Action Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const callId = data.callId;
  const action = event.action; // 'accept' | 'decline' | '' (clicked body)

  if (action === 'decline') {
    // User tapped Decline -> notify open clients to reject call
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({
            type: 'DECLINE_CALL',
            callId,
          });
        }
      })
    );
    return;
  }

  // User tapped Accept or clicked the notification body
  const targetUrl = data.url || (callId ? `/?callId=${callId}&action=accept` : '/');

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a 1 social tab is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({
            type: 'ACCEPT_INCOMING_CALL',
            callId,
          });
          return client.navigate(targetUrl);
        }
      }

      // If no window is open, launch a new standalone window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// 4. Notification Close Handler
self.addEventListener('notificationclose', (event) => {
  // Notification dismissed by user
});
