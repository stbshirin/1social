import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';

interface VerifiedEntry {
  isVerified: boolean;
  listeners: Set<(val: boolean) => void>;
  unsub: (() => void) | null;
}

// Shared module-level cache so multiple badges for the same UID (e.g. Feed + Comments)
// share a single Firestore listener without redundant reads.
const verifiedCache = new Map<string, VerifiedEntry>();

function subscribeToUserVerifiedStatus(
  uid: string,
  callback: (isVerified: boolean) => void,
  initialValue?: boolean
): () => void {
  let entry = verifiedCache.get(uid);

  if (!entry) {
    entry = {
      isVerified: initialValue === true,
      listeners: new Set(),
      unsub: null,
    };
    verifiedCache.set(uid, entry);

    const userDocRef = doc(db, 'socialApp_users', uid);
    entry.unsub = onSnapshot(
      userDocRef,
      (snap) => {
        const currentEntry = verifiedCache.get(uid);
        if (!currentEntry) return;
        const verified = snap.exists() ? snap.data()?.isVerified === true : false;
        currentEntry.isVerified = verified;
        currentEntry.listeners.forEach((cb) => cb(verified));
      },
      (err) => {
        console.warn('VerifiedBadge listener notice:', err?.message || err);
      }
    );
  } else if (typeof initialValue === 'boolean' && initialValue !== entry.isVerified) {
    entry.isVerified = initialValue;
  }

  entry.listeners.add(callback);
  callback(entry.isVerified);

  return () => {
    const currentEntry = verifiedCache.get(uid);
    if (!currentEntry) return;
    currentEntry.listeners.delete(callback);
    if (currentEntry.listeners.size === 0) {
      if (currentEntry.unsub) {
        try {
          currentEntry.unsub();
        } catch {
          // Ignored
        }
      }
      verifiedCache.delete(uid);
    }
  };
}

interface VerifiedBadgeProps {
  user?: {
    uid?: string;
    id?: string;
    isVerified?: boolean;
  } | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  user,
  size = 'xs',
  className = '',
}) => {
  const userId = user?.uid || user?.id;
  const propVerified = user?.isVerified;

  const [isVerified, setIsVerified] = useState<boolean>(propVerified === true);

  useEffect(() => {
    if (typeof propVerified === 'boolean') {
      setIsVerified(propVerified);
    }
  }, [propVerified]);

  useEffect(() => {
    if (!userId) {
      setIsVerified(false);
      return;
    }

    const unsubscribe = subscribeToUserVerifiedStatus(
      userId,
      (verified) => {
        setIsVerified(verified);
      },
      propVerified
    );

    return unsubscribe;
  }, [userId]);

  if (!isVerified) {
    return null;
  }

  const dimensions =
    size === 'xs'
      ? 'w-4 h-4'
      : size === 'sm'
      ? 'w-[18px] h-[18px]'
      : 'w-5 h-5';

  return (
    <span
      title="Verified Account"
      aria-label="Verified Account"
      className={`inline-flex items-center justify-center shrink-0 align-middle ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${dimensions} drop-shadow-[0_1px_2px_rgba(29,155,240,0.35)]`}
        aria-hidden="true"
      >
        <path
          d="M22.25 12C22.25 10.57 21.37 9.31 20.11 8.74C20.61 7.45 20.32 5.93 19.29 4.9C18.26 3.87 16.74 3.58 15.45 4.08C14.88 2.82 13.62 1.94 12.19 1.94C10.76 1.94 9.5 2.82 8.93 4.08C7.64 3.58 6.12 3.87 5.09 4.9C4.06 5.93 3.77 7.45 4.27 8.74C3.01 9.31 2.13 10.57 2.13 12C2.13 13.43 3.01 14.69 4.27 15.26C3.77 16.55 4.06 18.07 5.09 19.1C6.12 20.13 7.64 20.42 8.93 19.92C9.5 21.18 10.76 22.06 12.19 22.06C13.62 22.06 14.88 21.18 15.45 19.92C16.74 20.42 18.26 20.13 19.29 19.1C20.32 18.07 20.61 16.55 20.11 15.26C21.37 14.69 22.25 13.43 22.25 12Z"
          fill="#1D9BF0"
        />
        <path
          d="M9.6 15.6L6.6 12.6L7.95 11.25L9.6 12.9L16.05 6.45L17.4 7.8L9.6 15.6Z"
          fill="#FFFFFF"
        />
      </svg>
    </span>
  );
};
