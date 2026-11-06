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

// Persistent tab connection state across SPA re-renders
let currentActiveUid: string | null = null;
let currentConnectionRef: DatabaseReference | null = null;
let registeredBeforeUnload = false;

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

    if (currentConnectionRef) {
      try {
        await onDisconnect(currentConnectionRef).cancel();
      } catch (e) {}
      currentConnectionRef = null;
    }
    currentActiveUid = null;

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

  // If already initialized for this same user in this tab session, do not re-create connection node
  if (currentActiveUid === uid && currentConnectionRef) {
    syncFirestorePresence(uid, true);
    return () => {};
  }

  currentActiveUid = uid;

  try {
    const connectedRef = ref(rtdb, '.info/connected');
    const myConnectionsRef = ref(rtdb, `status/${uid}/connections`);
    const lastSeenRef = ref(rtdb, `status/${uid}/lastSeen`);
    const stateRef = ref(rtdb, `status/${uid}/state`);

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
          // Create a unique connection reference for THIS browser tab session
          if (!currentConnectionRef) {
            currentConnectionRef = push(myConnectionsRef);
          }

          // When this connection is lost or tab closes:
          // 1. Remove this tab connection key
          await onDisconnect(currentConnectionRef).remove();

          // 2. Set lastSeen timestamp on disconnect
          await onDisconnect(lastSeenRef).set(rtdbServerTimestamp());

          // 3. Mark tab connection as active
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
        const hasActive =
          connections !== null && typeof connections === 'object' && Object.keys(connections).length > 0;

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
    if (!registeredBeforeUnload) {
      registeredBeforeUnload = true;
      const handleBeforeUnload = () => {
        if (currentConnectionRef) {
          remove(currentConnectionRef).catch(() => {});
        }
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      window.addEventListener('pagehide', handleBeforeUnload);
    }

    return () => {
      // Note: In an SPA, we preserve currentConnectionRef during internal route navigation.
      // Connection is cleaned up on logout (setExplicitOffline) or tab unload.
      unsubscribeConnected();
      unsubscribeConnections();
    };
  } catch (err) {
    console.warn('Presence setup warning (RTDB offline or restricted):', err);
    return () => {};
  }
}

/**
 * Subscribes to any user's real-time online/offline presence state.
 * Uses Realtime Database and Firestore combined for 100% reliable state.
 */
export function subscribeToUserPresence(
  uid: string,
  onUpdate: (presence: UserPresenceState) => void
): () => void {
  if (!uid) {
    onUpdate({ isOnline: false, lastSeen: null });
    return () => {};
  }

  // If the target user is the authenticated user in this client, they are always Online
  const isSelf = auth.currentUser?.uid === uid;
  if (isSelf) {
    onUpdate({ isOnline: true, lastSeen: Date.now() });
  }

  let isMounted = true;
  let rtdbPresence: { isOnline: boolean; lastSeen: number | string | null } = {
    isOnline: isSelf,
    lastSeen: isSelf ? Date.now() : null,
  };
  let firestorePresence: { isOnline: boolean; lastSeen: number | string | null } = {
    isOnline: isSelf,
    lastSeen: isSelf ? Date.now() : null,
  };

  const emit = () => {
    if (!isMounted) return;
    if (isSelf) {
      onUpdate({ isOnline: true, lastSeen: Date.now() });
      return;
    }
    const online = rtdbPresence.isOnline || firestorePresence.isOnline;
    const lastSeen = online
      ? Date.now()
      : (rtdbPresence.lastSeen || firestorePresence.lastSeen || null);
    onUpdate({ isOnline: online, lastSeen });
  };

  let unsubRtdb: (() => void) | null = null;
  let unsubFirestore: (() => void) | null = null;

  try {
    const statusRef = ref(rtdb, `status/${uid}`);
    unsubRtdb = onValue(
      statusRef,
      (snapshot) => {
        if (!isMounted) return;
        const val = snapshot.val();
        if (val) {
          const connections = val.connections;
          const hasActiveConnections =
            connections && typeof connections === 'object' && Object.keys(connections).length > 0;
          const isOnline = Boolean(hasActiveConnections || val.state === 'online');
          rtdbPresence = {
            isOnline,
            lastSeen: isOnline ? Date.now() : (val.lastSeen || null),
          };
        } else {
          rtdbPresence = { isOnline: false, lastSeen: null };
        }
        emit();
      },
      (error) => {
        console.warn('Presence RTDB listener notice:', error?.message || error);
      }
    );
  } catch (e) {
    console.warn('RTDB subscribe error:', e);
  }

  try {
    const userDocRef = doc(db, 'socialApp_users', uid);
    unsubFirestore = onSnapshot(
      userDocRef,
      (docSnap) => {
        if (!isMounted) return;
        if (docSnap.exists()) {
          const data = docSnap.data();
          const isOnline = Boolean(data.isOnline);
          firestorePresence = {
            isOnline,
            lastSeen: isOnline ? Date.now() : (data.lastSeen || null),
          };
        } else {
          firestorePresence = { isOnline: false, lastSeen: null };
        }
        emit();
      },
      (err) => {
        console.warn('Firestore presence listener notice:', err?.message || err);
      }
    );
  } catch (e) {
    console.warn('Firestore subscribe error:', e);
  }

  return () => {
    isMounted = false;
    if (unsubRtdb) unsubRtdb();
    if (unsubFirestore) unsubFirestore();
  };
}

/**
 * Formats presence timestamp into user-friendly text:
 * - Online: "Online"
 * - Offline: "Offline" or "Last seen Xm ago" / "Last seen Xh ago"
 */
export function formatLastSeen(lastSeen?: number | string | null, isOnline?: boolean): string {
  if (isOnline) {
    return 'Online';
  }

  if (!lastSeen) {
    return 'Offline';
  }

  try {
    const timestamp = typeof lastSeen === 'number' ? lastSeen : new Date(lastSeen).getTime();
    if (isNaN(timestamp)) return 'Offline';

    const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);

    if (diffSeconds < 60) {
      return 'Last seen just now';
    }
    if (diffSeconds < 3600) {
      const mins = Math.floor(diffSeconds / 60);
      return `Last seen ${mins}m ago`;
    }
    if (diffSeconds < 86400) {
      const hours = Math.floor(diffSeconds / 3600);
      return `Last seen ${hours}h ago`;
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
