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
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { rtdb, db, auth } from '../firebase/config';
import { useState, useEffect } from 'react';

export interface UserPresenceState {
  isOnline: boolean;
  lastSeen?: number | string | null;
}

let activePresenceCleanup: (() => void) | null = null;

/**
 * Synchronizes presence to Firestore socialApp_users document
 */
async function syncFirestorePresence(uid: string, isOnline: boolean): Promise<void> {
  if (!uid) return;
  try {
    const userDocRef = doc(db, 'socialApp_users', uid);
    await updateDoc(userDocRef, {
      isOnline,
      lastSeen: new Date().toISOString(),
    });
  } catch (err) {
    // Non-blocking catch
  }
}

/**
 * Explicitly marks a user offline in RTDB and Firestore (e.g. on logout)
 */
export async function setExplicitOffline(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const stateRef = ref(rtdb, `status/${uid}/state`);
    const lastSeenRef = ref(rtdb, `status/${uid}/lastSeen`);
    const connectionsRef = ref(rtdb, `status/${uid}/connections`);

    await Promise.all([
      remove(connectionsRef).catch(() => {}),
      set(stateRef, 'offline').catch(() => {}),
      set(lastSeenRef, rtdbServerTimestamp()).catch(() => {}),
    ]);

    await syncFirestorePresence(uid, false);
  } catch (err) {
    console.warn('Error setting explicit offline state:', err);
  }
}

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
    const myConnectionsRef = ref(rtdb, `status/${uid}/connections`);
    const lastSeenRef = ref(rtdb, `status/${uid}/lastSeen`);
    const stateRef = ref(rtdb, `status/${uid}/state`);

    let currentConnectionRef: DatabaseReference | null = null;
    let hasRegisteredConnection = false;

    // Immediately mirror online status to Firestore
    syncFirestorePresence(uid, true);

    // Listen to /.info/connected
    const unsubscribeConnected = onValue(
      connectedRef,
      async (snap) => {
        const isConnected = snap.val() === true;
        if (!isConnected) {
          return;
        }

        try {
          // Create a unique connection reference for THIS browser tab
          currentConnectionRef = push(myConnectionsRef);

          // When this connection is lost / tab closes:
          // 1. Remove this connection key
          await onDisconnect(currentConnectionRef).remove();

          // 2. Set lastSeen timestamp on disconnect
          await onDisconnect(lastSeenRef).set(rtdbServerTimestamp());

          // 3. Mark this tab's connection as active
          await set(currentConnectionRef, true);
          await set(stateRef, 'online');
          await set(lastSeenRef, rtdbServerTimestamp());

          hasRegisteredConnection = true;
          syncFirestorePresence(uid, true);
        } catch (err) {
          console.warn('RTDB connection registration notice:', err);
        }
      },
      (error) => {
        console.warn('Presence .info/connected listener notice:', error?.message || error);
      }
    );

    // Watch connections to know when all tabs/devices close
    const unsubscribeConnections = onValue(
      myConnectionsRef,
      async (snap) => {
        const connections = snap.val();
        const hasActive = connections !== null && typeof connections === 'object' && Object.keys(connections).length > 0;

        if (hasActive) {
          hasRegisteredConnection = true;
          set(stateRef, 'online').catch(() => {});
          syncFirestorePresence(uid, true);
        } else if (hasRegisteredConnection) {
          // All active tabs closed -> mark offline
          set(stateRef, 'offline').catch(() => {});
          set(lastSeenRef, rtdbServerTimestamp()).catch(() => {});
          syncFirestorePresence(uid, false);
        }
      },
      (error) => {
        console.warn('Presence connections listener notice:', error?.message || error);
      }
    );

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
      unsubscribeConnected();
      unsubscribeConnections();
    };

    activePresenceCleanup = cleanup;
    return cleanup;
  } catch (err) {
    console.warn('Presence setup warning (RTDB offline or restricted):', err);
    return () => {};
  }
}

/**
 * Subscribes to any user's real-time online/offline presence state.
 * Uses Realtime Database with automatic Firestore fallback.
 */
export function subscribeToUserPresence(
  uid: string,
  onUpdate: (presence: UserPresenceState) => void
): () => void {
  if (!uid) {
    onUpdate({ isOnline: false, lastSeen: null });
    return () => {};
  }

  // If the target user is the authenticated user in this client, they are active now
  const isSelf = auth.currentUser?.uid === uid;
  if (isSelf) {
    onUpdate({ isOnline: true, lastSeen: Date.now() });
  }

  let isMounted = true;
  let unsubFirestore: (() => void) | null = null;

  try {
    const statusRef = ref(rtdb, `status/${uid}`);

    const unsubRtdb = onValue(
      statusRef,
      (snapshot) => {
        if (!isMounted) return;
        const val = snapshot.val();
        if (val) {
          const connections = val.connections;
          const hasActiveConnections = connections && typeof connections === 'object' && Object.keys(connections).length > 0;
          const isOnline = isSelf || Boolean(hasActiveConnections || val.state === 'online');
          const lastSeen = isOnline ? Date.now() : (val.lastSeen || null);

          onUpdate({ isOnline, lastSeen });
          return;
        }

        // If no RTDB status node exists yet, check Firestore socialApp_users
        fallbackFirestoreListener();
      },
      (error) => {
        console.warn('Presence subscription notice (RTDB), fallback to Firestore:', error?.message || error);
        fallbackFirestoreListener();
      }
    );

    function fallbackFirestoreListener() {
      if (unsubFirestore || !isMounted) return;
      try {
        const userDocRef = doc(db, 'socialApp_users', uid);
        unsubFirestore = onSnapshot(
          userDocRef,
          (docSnap) => {
            if (!isMounted) return;
            if (docSnap.exists()) {
              const data = docSnap.data();
              const isOnline = isSelf || Boolean(data.isOnline);
              const lastSeen = isOnline ? Date.now() : (data.lastSeen || null);
              onUpdate({ isOnline, lastSeen });
            } else {
              onUpdate({ isOnline: isSelf, lastSeen: isSelf ? Date.now() : null });
            }
          },
          (err) => {
            console.warn('Firestore presence fallback notice:', err?.message || err);
            onUpdate({ isOnline: isSelf, lastSeen: isSelf ? Date.now() : null });
          }
        );
      } catch {
        onUpdate({ isOnline: isSelf, lastSeen: isSelf ? Date.now() : null });
      }
    }

    return () => {
      isMounted = false;
      unsubRtdb();
      if (unsubFirestore) {
        unsubFirestore();
      }
    };
  } catch (err) {
    onUpdate({ isOnline: isSelf, lastSeen: isSelf ? Date.now() : null });
    return () => {};
  }
}

/**
 * Formats presence timestamp into user-friendly text
 */
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
 * Always guarantees that the logged in user sees themselves as Online.
 */
export function usePresence(userId?: string | null): {
  isOnline: boolean;
  lastSeen: number | string | null;
  lastSeenText: string;
} {
  const isSelf = Boolean(userId && auth.currentUser?.uid === userId);

  const [presence, setPresence] = useState<UserPresenceState>({
    isOnline: isSelf,
    lastSeen: isSelf ? Date.now() : null,
  });

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

  const effectiveIsOnline = isSelf || presence.isOnline;
  const effectiveLastSeen = effectiveIsOnline ? Date.now() : (presence.lastSeen ?? null);

  return {
    isOnline: effectiveIsOnline,
    lastSeen: effectiveLastSeen,
    lastSeenText: formatLastSeen(effectiveLastSeen, effectiveIsOnline),
  };
}
