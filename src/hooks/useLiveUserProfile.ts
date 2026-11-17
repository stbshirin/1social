import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { ref as rtdbRef, onValue as rtdbOnValue } from 'firebase/database';
import { db, rtdb } from '../firebase/config';
import { getDefaultAvatar, resolveSafePhotoUrl } from '../utils/callIdentity';

export { getDefaultAvatar, resolveSafePhotoUrl };

export interface LiveUserSummary {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string;
  isVerified: boolean;
}

/**
 * Loads a user's live profile (photoURL, displayName, username, isVerified) strictly by Firebase UID
 * from Firestore (`socialApp_users/{uid}`) with non-blocking RTDB (`users/{uid}`) sync.
 *
 * - Immediately invalidates any previous UID's data when `uid` changes (prevents stale/cached call images).
 * - Never returns another user's photo.
 * - Falls back cleanly to a deterministic default avatar for the exact UID.
 */
export function useLiveUserProfile(
  uid?: string | null,
  fallback?: {
    displayName?: string;
    username?: string;
    photoURL?: string;
    isVerified?: boolean;
  }
): LiveUserSummary {
  const cleanUid = (uid || '').trim();

  const [fetched, setFetched] = useState<{
    uid: string;
    displayName?: string;
    username?: string;
    photoURL?: string;
    isVerified?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!cleanUid) {
      setFetched(null);
      return;
    }

    let isMounted = true;
    // Clear previous UID's fetched data immediately to guarantee zero cross-user leakage
    setFetched(null);

    // 1. Primary live Firestore listener: socialApp_users/{uid}
    const userDocRef = doc(db, 'socialApp_users', cleanUid);
    const unsubFirestore = onSnapshot(
      userDocRef,
      (snap) => {
        if (!isMounted || !snap.exists()) return;
        const data = snap.data();
        setFetched((prev) => {
          const base = prev && prev.uid === cleanUid ? prev : { uid: cleanUid };
          return {
            ...base,
            uid: cleanUid,
            displayName: data.displayName || base.displayName,
            username: data.username || base.username,
            photoURL:
              typeof data.photoURL === 'string' && data.photoURL.trim().length > 0
                ? data.photoURL.trim()
                : base.photoURL,
            isVerified: data.isVerified === true,
          };
        });
      },
      () => {
        // Non-blocking fallback
      }
    );

    // 2. Non-blocking RTDB listener: users/{uid} (handles RTDB-synced photoURL updates if RTDB is enabled)
    let unsubRtdb: (() => void) | null = null;
    try {
      const rtdbUserNode = rtdbRef(rtdb, `users/${cleanUid}`);
      unsubRtdb = rtdbOnValue(
        rtdbUserNode,
        (snap) => {
          if (!isMounted) return;
          const val = snap.val();
          if (val && typeof val === 'object') {
            setFetched((prev) => {
              const base = prev && prev.uid === cleanUid ? prev : { uid: cleanUid };
              const rtdbPhoto =
                typeof val.photoURL === 'string' && val.photoURL.trim().length > 0
                  ? val.photoURL.trim()
                  : undefined;
              return {
                ...base,
                uid: cleanUid,
                displayName: val.displayName || base.displayName,
                username: val.username || base.username,
                photoURL: rtdbPhoto || base.photoURL,
              };
            });
          }
        },
        () => {
          // Silently ignore if RTDB is unavailable
        }
      );
    } catch {
      // Non-blocking
    }

    return () => {
      isMounted = false;
      unsubFirestore();
      if (unsubRtdb) {
        try {
          unsubRtdb();
        } catch {
          // Ignored
        }
      }
    };
  }, [cleanUid]);

  // Only accept fetched data if its UID strictly matches the currently requested UID
  const activeFetched = fetched && fetched.uid === cleanUid ? fetched : null;

  return {
    uid: cleanUid,
    displayName:
      activeFetched?.displayName ||
      fallback?.displayName ||
      '1 social Member',
    username:
      activeFetched?.username ||
      fallback?.username ||
      'user',
    photoURL: resolveSafePhotoUrl(
      activeFetched?.photoURL || fallback?.photoURL,
      cleanUid
    ),
    isVerified:
      typeof activeFetched?.isVerified === 'boolean'
        ? activeFetched.isVerified
        : fallback?.isVerified === true,
  };
}
