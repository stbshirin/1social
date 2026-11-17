import {
  doc,
  collection,
  setDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
  CollectionReference,
  DocumentReference,
} from 'firebase/firestore';
import { ref as rtdbRef, update as rtdbUpdate } from 'firebase/database';
import { db, rtdb } from '../firebase/config';
import { UserProfile } from '../types';

// The primary collections used for the separate socialApp user profiles
export const SOCIAL_APP_COLLECTION = 'socialApp';
export const SOCIAL_APP_USERS_SUBCOLLECTION = 'users';
export const SOCIAL_APP_USERS_DIRECT = 'socialApp_users';

/**
 * Returns document reference for a user in the new separate socialApp profile
 * Path: socialApp/app/users/{uid} and socialApp_users/{uid}
 */
export function getSocialUserDocRef(uid: string): DocumentReference {
  return doc(db, SOCIAL_APP_USERS_DIRECT, uid);
}

export function getSocialUserSubDocRef(uid: string): DocumentReference {
  return doc(db, SOCIAL_APP_COLLECTION, 'app', SOCIAL_APP_USERS_SUBCOLLECTION, uid);
}

/**
 * Returns collection reference for all socialApp users
 */
export function getSocialUsersCollection(): CollectionReference {
  return collection(db, SOCIAL_APP_USERS_DIRECT);
}

/**
 * Creates a brand new separate socialApp user profile without touching any legacy user data
 */
export async function createSocialUserProfile(uid: string, profileData: UserProfile): Promise<void> {
  const { verifiedAt: _vAt, verifiedBy: _vBy, ...safeInput } = profileData;
  const payload = {
    ...safeInput,
    isVerified: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 1. Write to socialApp_users/{uid}
  try {
    const directRef = getSocialUserDocRef(uid);
    await setDoc(directRef, payload, { merge: true });
  } catch (e) {
    console.warn('Direct user profile setDoc notice (will sync when online):', e);
  }

  // 2. Also write to socialApp/app/users/{uid}
  try {
    const subRef = getSocialUserSubDocRef(uid);
    await setDoc(subRef, payload, { merge: true });
  } catch (e) {
    console.warn('Subcollection sync notice:', e);
  }

  // 3. Write summary to socialApp/users parent doc for easy index lookup
  try {
    const parentDocRef = doc(db, SOCIAL_APP_COLLECTION, 'users');
    await setDoc(
      parentDocRef,
      {
        [uid]: {
          uid,
          displayName: profileData.displayName,
          username: profileData.username,
          photoURL: profileData.photoURL || '',
          updatedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );
  } catch (e) {
    // Non-blocking
  }
}

/**
 * Updates an existing socialApp user profile across the separate socialApp paths
 */
export async function updateSocialUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
  const payload = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  try {
    const directRef = getSocialUserDocRef(uid);
    await updateDoc(directRef, payload);
  } catch (e) {
    console.warn('Direct profile updateDoc notice:', e);
  }

  try {
    const subRef = getSocialUserSubDocRef(uid);
    await updateDoc(subRef, payload);
  } catch (e) {
    // Non-blocking
  }

  try {
    const parentDocRef = doc(db, SOCIAL_APP_COLLECTION, 'users');
    await setDoc(
      parentDocRef,
      {
        [uid]: {
          uid,
          displayName: data.displayName,
          username: data.username,
          photoURL: data.photoURL,
          updatedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );
  } catch (e) {
    // Non-blocking
  }
}

/**
 * Fetches the separate socialApp profile for a given UID with safe offline fallback
 */
export async function fetchSocialUserProfile(uid: string): Promise<UserProfile | null> {
  // Check direct doc first with safe error handling
  try {
    const directRef = getSocialUserDocRef(uid);
    const snap = await getDoc(directRef);
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() } as UserProfile;
    }
  } catch (err: any) {
    console.warn('fetchSocialUserProfile directRef check notice:', err?.message || err);
  }

  // Fallback check subcollection doc
  try {
    const subRef = getSocialUserSubDocRef(uid);
    const subSnap = await getDoc(subRef);
    if (subSnap.exists()) {
      return { id: subSnap.id, ...subSnap.data() } as UserProfile;
    }
  } catch (err: any) {
    console.warn('fetchSocialUserProfile subRef check notice:', err?.message || err);
  }

  return null;
}

const MAIN_ADMIN_UID = 'UI28ofvzB7cjNJvCG0DvYgbCu9J3';

/**
 * Grants or removes the Blue Verified Badge for a target user.
 * Strictly enforced for Main Admin UID UI28ofvzB7cjNJvCG0DvYgbCu9J3 (both client & Firestore rules).
 */
export async function setUserVerifiedStatus(
  targetUid: string,
  isVerified: boolean,
  adminUid?: string
): Promise<void> {
  if (!adminUid || adminUid !== MAIN_ADMIN_UID) {
    throw new Error('Unauthorized: Only the Main Admin can grant or remove the Verified Badge.');
  }
  if (!targetUid) {
    throw new Error('Target user UID is required.');
  }

  const nowIso = new Date().toISOString();
  const payload = isVerified
    ? {
        isVerified: true,
        verifiedAt: nowIso,
        verifiedBy: adminUid,
        updatedAt: nowIso,
      }
    : {
        isVerified: false,
        verifiedAt: null,
        verifiedBy: null,
        updatedAt: nowIso,
      };

  // Primary authoritative update in Firestore socialApp_users/{uid}
  const directRef = getSocialUserDocRef(targetUid);
  await updateDoc(directRef, payload);

  // Best-effort sync to hierarchical socialApp/app/users/{uid}
  try {
    const subRef = getSocialUserSubDocRef(targetUid);
    await setDoc(subRef, payload, { merge: true });
  } catch {
    // Non-blocking if secondary subdoc hasn't been initialized
  }

  // Non-blocking sync to Firebase Realtime Database users/{uid}
  try {
    const rtdbPayload = {
      isVerified,
      verifiedAt: isVerified ? nowIso : null,
      verifiedBy: isVerified ? adminUid : null,
      updatedAt: nowIso,
    };
    await Promise.race([
      rtdbUpdate(rtdbRef(rtdb, `users/${targetUid}`), rtdbPayload),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Non-blocking if RTDB is unavailable
  }
}
