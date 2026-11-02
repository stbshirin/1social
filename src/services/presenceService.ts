import {
  ref,
  onValue,
  onDisconnect,
  set,
  push,
  serverTimestamp as rtdbServerTimestamp,
  DatabaseReference,
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

    const unsubscribeConnected = onValue(connectedRef, async (snap) => {
      const isConnected = snap.val() === true;

      if (!isConnected) {
        // Disconnected from RTDB
        return;
      }

      // Create a unique connection reference for this browser tab
      currentConnectionRef = push(myConnectionsRef);

      // On disconnect: remove this connection record
      onDisconnect(currentConnectionRef).remove();

      // On disconnect: set status to offline and timestamp lastSeen
      onDisconnect(stateRef).set('offline');
      onDisconnect(lastSeenRef).set(rtdbServerTimestamp());

      // Set current session online
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

    const cleanup = () => {
      if (currentConnectionRef) {
        set(currentConnectionRef, null).catch(() => {});
      }
      set(stateRef, 'offline').catch(() => {});
      set(lastSeenRef, rtdbServerTimestamp()).catch(() => {});
      unsubscribeConnected();

      try {
        const firestoreUserRef = doc(db, 'socialApp_users', uid);
        updateDoc(firestoreUserRef, {
          isOnline: false,
          lastSeen: new Date().toISOString(),
        }).catch(() => {});
      } catch (e) {
        // Non-blocking
      }
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
      return `Active ${Math.floor(diffSeconds / 60)}m ago`;
    }
    if (diffSeconds < 86400) {
      return `Active ${Math.floor(diffSeconds / 3600)}h ago`;
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
