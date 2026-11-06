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
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { rtdb, db, auth } from '../firebase/config';
import { useState, useEffect } from 'react';

export interface UserPresenceState {
  isOnline: boolean;
  lastSeen?: number | string | null;
}

let activePresenceCleanup: (() => void) | null = null;
const TAB_STORAGE_PREFIX = '1social_presence_tabs_';

/**
 * Tab registry management to support multiple tabs / devices cleanly.
 * If one tab closes, other open tabs keep the user online.
 * Only when all tabs close does the user get marked offline.
 */
function registerTab(uid: string, tabId: string): number {
  try {
    const raw = localStorage.getItem(`${TAB_STORAGE_PREFIX}${uid}`);
    const parsed: Record<string, number> = raw ? JSON.parse(raw) : {};
    parsed[tabId] = Date.now();
    localStorage.setItem(`${TAB_STORAGE_PREFIX}${uid}`, JSON.stringify(parsed));
    return Object.keys(parsed).length;
  } catch {
    return 1;
  }
}

function pingTab(uid: string, tabId: string): void {
  try {
    const raw = localStorage.getItem(`${TAB_STORAGE_PREFIX}${uid}`);
    const parsed: Record<string, number> = raw ? JSON.parse(raw) : {};
    parsed[tabId] = Date.now();
    localStorage.setItem(`${TAB_STORAGE_PREFIX}${uid}`, JSON.stringify(parsed));
  } catch {
    // Non-blocking
  }
}

function unregisterTab(uid: string, tabId: string): number {
  try {
    const raw = localStorage.getItem(`${TAB_STORAGE_PREFIX}${uid}`);
    if (!raw) return 0;
    const parsed: Record<string, number> = JSON.parse(raw);
    delete parsed[tabId];

    const now = Date.now();
    const remaining: Record<string, number> = {};
    for (const [id, time] of Object.entries(parsed)) {
      if (now - time < 60000) {
        remaining[id] = time;
      }
    }
    localStorage.setItem(`${TAB_STORAGE_PREFIX}${uid}`, JSON.stringify(remaining));
    return Object.keys(remaining).length;
  } catch {
    return 0;
  }
}

function clearAllTabs(uid: string): void {
  try {
    localStorage.removeItem(`${TAB_STORAGE_PREFIX}${uid}`);
  } catch {
    // Non-blocking
  }
}

/**
 * Synchronizes presence to Firestore socialApp_users document
 */
async function syncFirestorePresence(uid: string, isOnline: boolean): Promise<void> {
  if (!uid) return;
  try {
    const userDocRef = doc(db, 'socialApp_users', uid);
    await setDoc(
      userDocRef,
      {
        uid,
        isOnline,
        lastSeen: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('Firestore presence sync notice:', err);
  }
}

/**
 * Explicitly marks a user offline in Firestore and RTDB (e.g. on logout)
 */
export async function setExplicitOffline(uid: string): Promise<void> {
  if (!uid) return;
  clearAllTabs(uid);

  try {
    await syncFirestorePresence(uid, false);

    // Also update RTDB if reachable
    try {
      const stateRef = ref(rtdb, `status/${uid}/state`);
      const lastSeenRef = ref(rtdb, `status/${uid}/lastSeen`);
      const connectionsRef = ref(rtdb, `status/${uid}/connections`);

      await Promise.all([
        remove(connectionsRef).catch(() => {}),
        set(stateRef, 'offline').catch(() => {}),
        set(lastSeenRef, rtdbServerTimestamp()).catch(() => {}),
      ]);
    } catch {
      // Non-blocking
    }
  } catch (err) {
    console.warn('Error setting explicit offline state:', err);
  }
}

/**
 * Initializes reliable Firebase Presence for the authenticated user.
 * Supports multiple tabs / devices cleanly via session connection records.
 * If one tab closes, other open tabs keep the user online.
 * When the last tab closes or disconnects, immediately marks the user offline.
 */
export function setupUserPresence(uid: string): () => void {
  if (!uid) return () => {};

  if (activePresenceCleanup) {
    activePresenceCleanup();
    activePresenceCleanup = null;
  }

  const thisTabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  let heartbeatInterval: any = null;
  let currentConnectionRef: DatabaseReference | null = null;

  // 1. Register this tab in local tab registry
  registerTab(uid, thisTabId);

  // 2. Immediately mark user online in Firestore for instant reactivity
  syncFirestorePresence(uid, true);

  // 3. Heartbeat every 25 seconds to keep active session fresh
  heartbeatInterval = setInterval(() => {
    pingTab(uid, thisTabId);
    syncFirestorePresence(uid, true);
  }, 25000);

  // 4. Setup Realtime Database presence (if RTDB instance is enabled)
  try {
    const connectedRef = ref(rtdb, '.info/connected');
    const myConnectionsRef = ref(rtdb, `status/${uid}/connections`);
    const lastSeenRef = ref(rtdb, `status/${uid}/lastSeen`);
    const stateRef = ref(rtdb, `status/${uid}/state`);

    const unsubscribeConnected = onValue(
      connectedRef,
      async (snap) => {
        if (snap.val() !== true) return;

        try {
          currentConnectionRef = push(myConnectionsRef);
          await onDisconnect(currentConnectionRef).remove();
          await onDisconnect(lastSeenRef).set(rtdbServerTimestamp());
          await set(currentConnectionRef, true);
          await set(stateRef, 'online');
          await set(lastSeenRef, rtdbServerTimestamp());
        } catch {
          // Non-blocking
        }
      },
      () => {}
    );

    const handleBeforeUnload = () => {
      const remainingTabs = unregisterTab(uid, thisTabId);
      if (currentConnectionRef) {
        remove(currentConnectionRef).catch(() => {});
      }
      if (remainingTabs === 0) {
        // Last tab closed -> set offline
        syncFirestorePresence(uid, false);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    const cleanup = () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      const remainingTabs = unregisterTab(uid, thisTabId);
      if (currentConnectionRef) {
        remove(currentConnectionRef).catch(() => {});
      }

      if (remainingTabs === 0) {
        syncFirestorePresence(uid, false);
      }

      unsubscribeConnected();
    };

    activePresenceCleanup = cleanup;
    return cleanup;
  } catch (err) {
    // If RTDB is unavailable, local tab + Firestore tracking functions seamlessly
    const handleBeforeUnload = () => {
      const remainingTabs = unregisterTab(uid, thisTabId);
      if (remainingTabs === 0) {
        syncFirestorePresence(uid, false);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    const cleanup = () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      const remainingTabs = unregisterTab(uid, thisTabId);
      if (remainingTabs === 0) {
        syncFirestorePresence(uid, false);
      }
    };

    activePresenceCleanup = cleanup;
    return cleanup;
  }
}

/**
 * Subscribes to any user's real-time online/offline presence state.
 * Uses Firestore with instantaneous live listener and RTDB sync.
 */
export function subscribeToUserPresence(
  uid: string,
  onUpdate: (presence: UserPresenceState) => void
): () => void {
  if (!uid) {
    onUpdate({ isOnline: false, lastSeen: null });
    return () => {};
  }

  let isMounted = true;

  // 1. Real-time Firestore listener on socialApp_users
  const userDocRef = doc(db, 'socialApp_users', uid);
  const unsubFirestore = onSnapshot(
    userDocRef,
    (docSnap) => {
      if (!isMounted) return;
      if (docSnap.exists()) {
        const data = docSnap.data();
        const rawIsOnline = Boolean(data.isOnline);
        const lastSeen = data.lastSeen || null;

        // Verify that online status hasn't expired (over 2.5 minutes without heartbeat)
        let isOnline = rawIsOnline;
        if (rawIsOnline && lastSeen) {
          const lastSeenTime = typeof lastSeen === 'number' ? lastSeen : new Date(lastSeen).getTime();
          if (!isNaN(lastSeenTime) && Date.now() - lastSeenTime > 150000) {
            isOnline = false;
          }
        }

        onUpdate({ isOnline, lastSeen });
      } else {
        onUpdate({ isOnline: false, lastSeen: null });
      }
    },
    (err) => {
      console.warn('Firestore presence listener notice:', err);
      onUpdate({ isOnline: false, lastSeen: null });
    }
  );

  // 2. Also listen to Realtime Database status (if provisioned)
  let unsubRtdb: (() => void) | null = null;
  try {
    const statusRef = ref(rtdb, `status/${uid}`);
    unsubRtdb = onValue(
      statusRef,
      (snapshot) => {
        if (!isMounted) return;
        const val = snapshot.val();
        if (val) {
          const connections = val.connections;
          const hasActiveConnections = connections && typeof connections === 'object' && Object.keys(connections).length > 0;
          const isOnline = Boolean(hasActiveConnections || val.state === 'online');
          const lastSeen = isOnline ? Date.now() : (val.lastSeen || null);
          onUpdate({ isOnline, lastSeen });
        }
      },
      () => {}
    );
  } catch {
    // Non-blocking
  }

  return () => {
    isMounted = false;
    unsubFirestore();
    if (unsubRtdb) unsubRtdb();
  };
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
 * Always guarantees that the logged-in user sees themselves as Online.
 */
export function usePresence(
  userId?: string | null,
  isSelfHint?: boolean
): {
  isOnline: boolean;
  lastSeen: number | string | null;
  lastSeenText: string;
} {
  const [currentAuthUid, setCurrentAuthUid] = useState<string | null>(auth.currentUser?.uid || null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentAuthUid(user?.uid || null);
    });
    return () => unsubAuth();
  }, []);

  const isSelf = Boolean(
    isSelfHint ||
    (userId && (currentAuthUid === userId || auth.currentUser?.uid === userId))
  );

  const [presence, setPresence] = useState<UserPresenceState>({
    isOnline: isSelf,
    lastSeen: isSelf ? Date.now() : null,
  });

  useEffect(() => {
    if (!userId) {
      setPresence({ isOnline: false, lastSeen: null });
      return;
    }

    if (isSelf) {
      setPresence({ isOnline: true, lastSeen: Date.now() });
      return;
    }

    const unsub = subscribeToUserPresence(userId, (next) => {
      setPresence(next);
    });

    return () => unsub();
  }, [userId, isSelf]);

  const effectiveIsOnline = isSelf || presence.isOnline;
  const effectiveLastSeen = effectiveIsOnline ? Date.now() : (presence.lastSeen ?? null);

  return {
    isOnline: effectiveIsOnline,
    lastSeen: effectiveLastSeen,
    lastSeenText: formatLastSeen(effectiveLastSeen, effectiveIsOnline),
  };
}
