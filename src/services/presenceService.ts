import {
  ref,
  onValue,
  onDisconnect,
  set,
  push,
  serverTimestamp as rtdbServerTimestamp,
  DatabaseReference,
  remove,
} from 'firebase/database';
import { doc, updateDoc } from 'firebase/firestore';
import { rtdb, db } from '../firebase/config';
import { useState, useEffect } from 'react';

export interface UserPresenceState {
  isOnline: boolean;
  lastSeen?: number | string | null;
}

let activePresenceCleanup: (() => void) | null = null;

/**
 * Initializes reliable Firebase Realtime Database presence for the authenticated user.
 * Supports multiple tabs / devices cleanly via session connection records.
 * If one tab closes, other open tabs keep the user online.
 * When the last tab closes or disconnects, onDisconnect immediately marks the user offline.
 */
export function setupUserPresence(uid: string): () => void {
  if (!uid) return () => {};

  if (activePresenceCleanup) {
    activePresenceCleanup();
    activePresenceCleanup = null;
  }

  try {
    const connectedRef = ref(rtdb, '.info/connected');
    const userStatusRef = ref(rtdb, `status/${uid}`);
    const myConnectionsRef = ref(rtdb, `status/${uid}/connections`);
    const lastSeenRef = ref(rtdb, `status/${uid}/lastSeen`);
    const stateRef = ref(rtdb, `status/${uid}/state`);

    let currentConnectionRef: DatabaseReference | null = null;
    let connectionsListenerUnsub: (() => void) | null = null;

    // Listen to /.info/connected
    const unsubscribeConnected = onValue(connectedRef, async (snap) => {
      const isConnected = snap.val() === true;

      if (!isConnected) {
        return;
      }

      // Create a unique connection reference for THIS browser tab
      currentConnectionRef = push(myConnectionsRef);

      // When this tab disconnects:
      // 1. Remove this connection key
      await onDisconnect(currentConnectionRef).remove();

      // 2. Prepare fallback offline mark and lastSeen timestamp
      await onDisconnect(lastSeenRef).set(rtdbServerTimestamp());

      // Set this tab's connection to true
      await set(currentConnectionRef, true);
      await set(stateRef, 'online');
      await set(lastSeenRef, rtdbServerTimestamp());

      // Also mirror online status to Firestore document for offline queries
      try {
        const firestoreUserRef = doc(db, 'socialApp_users', uid);
        await updateDoc(firestoreUserRef, {
          isOnline: true,
          lastSeen: new Date().toISOString(),
        });
      } catch (e) {
        // Non-blocking
      }
    });

    // Listen to all connections for this user to accurately set state
    connectionsListenerUnsub = onValue(myConnectionsRef, async (cSnap) => {
      const connections = cSnap.val();
      const hasConnections = connections && Object.keys(connections).length > 0;

      if (!hasConnections) {
        // No active tabs remaining -> set offline
        await set(stateRef, 'offline').catch(() => {});
        await set(lastSeenRef, rtdbServerTimestamp()).catch(() => {});
        try {
          const firestoreUserRef = doc(db, 'socialApp_users', uid);
          await updateDoc(firestoreUserRef, {
            isOnline: false,
            lastSeen: new Date().toISOString(),
          }).catch(() => {});
        } catch (e) {
          // Non-blocking
        }
      } else {
        await set(stateRef, 'online').catch(() => {});
      }
    });

    // Browser unload / close event to immediately remove this tab's connection
    const handleBeforeUnload = () => {
      if (currentConnectionRef) {
        remove(currentConnectionRef).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    const cleanup = () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);

      if (currentConnectionRef) {
        remove(currentConnectionRef).catch(() => {});
      }
      if (connectionsListenerUnsub) {
        connectionsListenerUnsub();
      }
      unsubscribeConnected();
    };

    activePresenceCleanup = cleanup;
    return cleanup;
  } catch (err) {
    console.warn('Presence setup warning (RTDB offline or restricted):', err);
    return () => {};
  }
}

/**
 * Subscribes to another user's real-time online/offline presence state.
 */
export function subscribeToUserPresence(
  uid: string,
  onUpdate: (presence: UserPresenceState) => void
): () => void {
  if (!uid) {
    onUpdate({ isOnline: false });
    return () => {};
  }

  try {
    const statusRef = ref(rtdb, `status/${uid}`);

    const unsubscribe = onValue(
      statusRef,
      (snapshot) => {
        const val = snapshot.val();
        if (!val) {
          onUpdate({ isOnline: false, lastSeen: null });
          return;
        }

        const connections = val.connections;
        const hasActiveConnections = connections && Object.keys(connections).length > 0;
        const isOnline = hasActiveConnections || val.state === 'online';
        const lastSeen = val.lastSeen || null;

        onUpdate({ isOnline, lastSeen });
      },
      (error) => {
        console.warn('Presence subscription notice:', error?.message || error);
        onUpdate({ isOnline: false, lastSeen: null });
      }
    );

    return () => unsubscribe();
  } catch (err) {
    onUpdate({ isOnline: false });
    return () => {};
  }
}

export function formatLastSeen(lastSeen?: number | string | null, isOnline?: boolean): string {
  if (isOnline) {
    return 'Active now';
  }

  if (!lastSeen) {
    return 'Offline';
  }

  try {
    const timestamp = typeof lastSeen === 'number' ? lastSeen : new Date(lastSeen).getTime();
    if (isNaN(timestamp)) return 'Offline';

    const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);

    if (diffSeconds < 60) {
      return 'Active just now';
    }
    if (diffSeconds < 3600) {
      const mins = Math.floor(diffSeconds / 60);
      return `Active ${mins}m ago`;
    }
    if (diffSeconds < 86400) {
      const hours = Math.floor(diffSeconds / 3600);
      return `Active ${hours}h ago`;
    }
    return `Last seen ${new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  } catch {
    return 'Offline';
  }
}

/**
 * React hook to listen to any user's presence state in real time.
 */
export function usePresence(userId?: string | null): {
  isOnline: boolean;
  lastSeen: number | string | null;
  lastSeenText: string;
} {
  const [presence, setPresence] = useState<UserPresenceState>({ isOnline: false, lastSeen: null });

  useEffect(() => {
    if (!userId) {
      setPresence({ isOnline: false, lastSeen: null });
      return;
    }

    const unsub = subscribeToUserPresence(userId, (next) => {
      setPresence(next);
    });

    return () => unsub();
  }, [userId]);

  return {
    isOnline: presence.isOnline,
    lastSeen: presence.lastSeen || null,
    lastSeenText: formatLastSeen(presence.lastSeen, presence.isOnline),
  };
}
