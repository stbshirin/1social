/**
 * 1 social — Firebase Cloud Functions
 * Automated FCM Background Incoming Call Push Notifications
 * Uses Firebase Admin SDK to securely send high-priority push notifications
 * without exposing any server credentials or service accounts to the frontend.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * Trigger: When a new call document is created in /calls/{callId}
 * Action: Finds all registered FCM tokens for the receiver and sends an incoming call push notification
 */
exports.onCallCreated = functions.firestore
  .document('calls/{callId}')
  .onCreate(async (snap, context) => {
    const callData = snap.data();
    if (!callData) return null;

    const callId = context.params.callId;
    const { calleeId, callerId, callerName, callerUsername, callerPhoto, type, status } = callData;

    if (!calleeId || status !== 'ringing') {
      return null;
    }

    try {
      // 1. Fetch all active device tokens for the callee
      const tokensSnap = await db
        .collection('fcmTokens')
        .where('userId', '==', calleeId)
        .get();

      if (tokensSnap.empty) {
        console.log(`[onCallCreated] No FCM tokens found for callee ${calleeId}`);
        return null;
      }

      const tokenDocs = tokensSnap.docs;
      const tokens = tokenDocs.map((doc) => doc.data().token).filter(Boolean);

      if (tokens.length === 0) {
        return null;
      }

      const isVideo = type === 'video';
      const notificationTitle = `Incoming ${isVideo ? 'Video' : 'Audio'} Call`;
      const notificationBody = `${callerName || 'Someone'} (@${callerUsername || 'user'}) is calling you...`;

      // 2. Build high-priority FCM Multicast Message
      const message = {
        tokens,
        data: {
          type: 'incoming_call',
          callId: String(callId),
          callerId: String(callerId || ''),
          callerName: String(callerName || '1 social Member'),
          callerUsername: String(callerUsername || 'user'),
          callerPhoto: String(callerPhoto || ''),
          callType: String(type || 'audio'),
          status: 'ringing',
          createdAt: String(Date.now()),
        },
        android: {
          priority: 'high',
          ttl: 60 * 1000, // 60 seconds time-to-live for ringing calls
          notification: {
            title: notificationTitle,
            body: notificationBody,
            icon: '/icon-192.png',
            color: '#4f46e5',
            sound: 'default',
            tag: `call-${callId}`, // Deduplication tag
            clickAction: `/?callId=${callId}&action=accept`,
          },
        },
        webpush: {
          headers: {
            Urgency: 'high',
            TTL: '60',
          },
          notification: {
            title: notificationTitle,
            body: notificationBody,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            image: callerPhoto && callerPhoto.startsWith('http') ? callerPhoto : undefined,
            tag: `call-${callId}`,
            renotify: true,
            requireInteraction: true,
            vibrate: [300, 150, 300, 150, 300, 150, 600, 200, 600],
            actions: [
              { action: 'accept', title: '📞 Accept' },
              { action: 'decline', title: '❌ Decline' },
            ],
            data: {
              callId,
              callType: type,
              url: `/?callId=${callId}&action=accept`,
            },
          },
          fcmOptions: {
            link: `/?callId=${callId}&action=accept`,
          },
        },
      };

      // 3. Send Multicast Push Notification
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[onCallCreated] Sent ${response.successCount} call notifications, ${response.failureCount} failed.`);

      // 4. Clean up invalid/stale device tokens
      if (response.failureCount > 0) {
        const batch = db.batch();
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error?.code;
            if (
              errCode === 'messaging/registration-token-not-registered' ||
              errCode === 'messaging/invalid-registration-token'
            ) {
              batch.delete(tokenDocs[idx].ref);
            }
          }
        });
        await batch.commit().catch(() => {});
      }

      return null;
    } catch (error) {
      console.error('[onCallCreated] Error dispatching incoming call push notification:', error);
      return null;
    }
  });

/**
 * Trigger: When a call document is updated in /calls/{callId}
 * Action: If call was ended, rejected, or cancelled, sends a silent data push to close active notifications
 */
exports.onCallUpdated = functions.firestore
  .document('calls/{callId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data();
    const afterData = change.after.data();
    const callId = context.params.callId;

    if (!afterData) return null;

    const newStatus = afterData.status;
    const oldStatus = beforeData ? beforeData.status : null;

    // Only trigger when moving from ringing/offering to a terminal status
    const isTerminal = newStatus === 'ended' || newStatus === 'rejected' || newStatus === 'missed' || newStatus === 'cancelled';
    if (!isTerminal || oldStatus === newStatus) {
      return null;
    }

    try {
      const calleeId = afterData.calleeId;
      if (!calleeId) return null;

      const tokensSnap = await db
        .collection('fcmTokens')
        .where('userId', '==', calleeId)
        .get();

      if (tokensSnap.empty) return null;

      const tokens = tokensSnap.docs.map((doc) => doc.data().token).filter(Boolean);
      if (tokens.length === 0) return null;

      // Silent data message telling the service worker to dismiss the notification
      const cancelMessage = {
        tokens,
        data: {
          type: 'cancel_call',
          callId: String(callId),
          status: String(newStatus),
        },
        android: {
          priority: 'high',
        },
        webpush: {
          headers: {
            Urgency: 'high',
          },
        },
      };

      await admin.messaging().sendEachForMulticast(cancelMessage);
      console.log(`[onCallUpdated] Sent cancel call push for callId: ${callId}`);
      return null;
    } catch (err) {
      console.error('[onCallUpdated] Error sending call cancellation push:', err);
      return null;
    }
  });

/**
 * HTTPS Callable: Directly dispatch an incoming call notification (e.g. from frontend with token)
 */
exports.sendCallNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be signed in.');
  }

  const { callId, calleeId, callerName, callerUsername, callerPhoto, type } = data;
  if (!callId || !calleeId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing callId or calleeId.');
  }

  const tokensSnap = await db.collection('fcmTokens').where('userId', '==', calleeId).get();
  if (tokensSnap.empty) return { success: false, reason: 'no_tokens' };

  const tokens = tokensSnap.docs.map((d) => d.data().token).filter(Boolean);
  if (tokens.length === 0) return { success: false, reason: 'no_valid_tokens' };

  const isVideo = type === 'video';
  const notificationTitle = `Incoming ${isVideo ? 'Video' : 'Audio'} Call`;
  const notificationBody = `${callerName || 'Someone'} is calling you...`;

  const message = {
    tokens,
    data: {
      type: 'incoming_call',
      callId: String(callId),
      callerName: String(callerName || '1 social Member'),
      callerUsername: String(callerUsername || 'user'),
      callerPhoto: String(callerPhoto || ''),
      callType: String(type || 'audio'),
      status: 'ringing',
    },
    android: {
      priority: 'high',
      ttl: 60 * 1000,
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '60' },
      notification: {
        title: notificationTitle,
        body: notificationBody,
        icon: '/icon-192.png',
        tag: `call-${callId}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 150, 300, 150, 300, 150, 600, 200, 600],
        actions: [
          { action: 'accept', title: '📞 Accept' },
          { action: 'decline', title: '❌ Decline' },
        ],
        data: {
          callId,
          url: `/?callId=${callId}&action=accept`,
        },
      },
    },
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  return { success: true, successCount: response.successCount };
});
