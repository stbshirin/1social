import { getMessaging, getToken, deleteToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { collection, doc, setDoc, deleteDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { app, db } from '../firebase/config';
import { CallSession } from '../types';

let messagingInstance: Messaging | null = null;
let currentDeviceToken: string | null = null;

// Public VAPID Key: Can be configured in .env as VITE_FIREBASE_VAPID_KEY or set here
export const VAPID_KEY =
  (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY ||
  ''; // Configured via Firebase Console -> Cloud Messaging -> Web Push certificates

/**
 * Safely initializes Firebase Messaging instance if supported by the browser
 */
export async function getFCMInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return null;
  if (messagingInstance) return messagingInstance;

  try {
    const supported = await isSupported();
    if (supported) {
      messagingInstance = getMessaging(app);
      return messagingInstance;
    }
  } catch (err) {
    console.warn('FCM isSupported check notice:', err);
  }
  return null;
}

/**
 * Creates a stable document ID from an FCM token
 */
function getTokenDocId(token: string): string {
  // Use a base64/alphanumeric hash or sanitized suffix
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = (hash << 5) - hash + token.charCodeAt(i);
    hash |= 0;
  }
  const cleanSuffix = token.slice(-24).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `fcm_${Math.abs(hash)}_${cleanSuffix}`;
}

/**
 * Registers the background service worker for FCM
 */
async function getFCMServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;

  try {
    const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (existing) {
      return existing;
    }
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  } catch (e) {
    console.warn('Service worker registration for FCM notice:', e);
    // Fall back to any active service worker
    return (await navigator.serviceWorker.ready) || undefined;
  }
}

/**
 * Requests Notification permission and registers device FCM token in Firestore
 */
export async function requestFCMToken(userId: string): Promise<string | null> {
  if (!userId || typeof window === 'undefined' || !('Notification' in window)) {
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return null;
    }

    const messaging = await getFCMInstance();
    if (!messaging) {
      return null;
    }

    const swReg = await getFCMServiceWorkerRegistration();

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY || undefined,
      serviceWorkerRegistration: swReg,
    });

    if (token) {
      currentDeviceToken = token;
      const docId = getTokenDocId(token);
      const isAndroid = /android/i.test(navigator.userAgent);
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

      const tokenRef = doc(db, 'fcmTokens', docId);
      await setDoc(
        tokenRef,
        {
          tokenId: docId,
          userId,
          token,
          platform: isAndroid ? 'android' : isIOS ? 'ios' : 'web',
          userAgent: navigator.userAgent.slice(0, 300),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      return token;
    }
  } catch (err: any) {
    console.warn('FCM token request notice:', err?.message || err);
  }

  return null;
}

/**
 * Removes the current device's FCM token on logout
 */
export async function removeFCMToken(userId: string): Promise<void> {
  if (!userId) return;

  try {
    if (currentDeviceToken) {
      const docId = getTokenDocId(currentDeviceToken);
      await deleteDoc(doc(db, 'fcmTokens', docId)).catch(() => {});

      const messaging = await getFCMInstance();
      if (messaging) {
        await deleteToken(messaging).catch(() => {});
      }
      currentDeviceToken = null;
    }
  } catch (err) {
    console.warn('FCM token deletion notice:', err);
  }
}

/**
 * Subscribes to foreground push notifications
 */
export async function setupForegroundFCMListener(
  onIncomingCall: (callData: any) => void
): Promise<(() => void) | null> {
  const messaging = await getFCMInstance();
  if (!messaging) return null;

  try {
    const unsub = onMessage(messaging, (payload) => {
      const data = payload.data;
      if (data && (data.callId || data.type === 'incoming_call')) {
        onIncomingCall(data);
      }
    });
    return unsub;
  } catch (e) {
    return null;
  }
}

/**
 * Sends a background push notification for an incoming call to the receiver
 * Dispatches via Firebase Cloud Function or server-side proxy
 */
export async function dispatchCallPushNotification(call: CallSession): Promise<void> {
  if (!call || !call.calleeId) return;

  try {
    // 1. Fetch callee's active registered device tokens
    const q = query(collection(db, 'fcmTokens'), where('userId', '==', call.calleeId));
    const tokenDocs = await getDocs(q);

    if (tokenDocs.empty) {
      return;
    }

    const tokens = tokenDocs.docs.map((d) => d.data().token).filter(Boolean);
    if (tokens.length === 0) return;

    // 2. Dispatch push notification payload to Cloud Function or API endpoint
    await fetch('/api/notifications/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokens,
        callId: call.id,
        callerId: call.callerId,
        callerName: call.callerName,
        callerUsername: call.callerUsername,
        callerPhoto: call.callerPhoto,
        callType: call.type,
        status: call.status,
      }),
    }).catch(() => {
      // Non-blocking failover
    });
  } catch (err) {
    console.warn('Dispatch call push notification notice:', err);
  }
}

/**
 * Dispatches a silent cancellation push notification to dismiss active incoming call notifications
 */
export async function dispatchCancelCallPushNotification(callId: string, calleeId: string): Promise<void> {
  if (!callId || !calleeId) return;

  try {
    const q = query(collection(db, 'fcmTokens'), where('userId', '==', calleeId));
    const tokenDocs = await getDocs(q);

    if (tokenDocs.empty) return;

    const tokens = tokenDocs.docs.map((d) => d.data().token).filter(Boolean);
    if (tokens.length === 0) return;

    await fetch('/api/notifications/cancel-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokens,
        callId,
        status: 'ended',
      }),
    }).catch(() => {});
  } catch (err) {
    console.warn('Dispatch cancel call push notice:', err);
  }
}
