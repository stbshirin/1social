import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { UserProfile } from '../types';
import {
  getSocialUserDocRef,
  fetchSocialUserProfile,
  createSocialUserProfile,
  updateSocialUserProfile,
} from '../services/userService';

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  signUpWithEmail: (email: string, pass: string, name: string, username: string) => Promise<void>;
  logInWithEmail: (email: string, pass: string) => Promise<void>;
  logInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ADMIN_EMAIL = 'stb.shirin@gmail.com';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  /**
   * Sync or create user profile specifically at the separate socialApp paths
   * (socialApp/users/{firebaseAuthUID} and socialApp_users/{firebaseAuthUID})
   * Does NOT import old user profile data from the legacy users collection.
   */
  const syncSocialUserProfile = async (user: User, extraName?: string, extraUsername?: string) => {
    try {
      const isUserAdmin = user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

      // Check if separate socialApp profile already exists
      const existingProfile = await fetchSocialUserProfile(user.uid);

      if (!existingProfile) {
        // Create new separate profile for this new application
        const generatedUsername =
          extraUsername ||
          user.email?.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') ||
          `user_${user.uid.slice(0, 5)}`;

        const newProfile: UserProfile = {
          id: user.uid,
          uid: user.uid,
          email: user.email || '',
          displayName: extraName || user.displayName || generatedUsername,
          username: generatedUsername,
          photoURL: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
          coverURL: 'https://images.unsplash.com/photo-1707343843437-caacff5cfa74?w=1200&auto=format&fit=crop&q=80',
          bio: 'Hey there! I am using 1 social.',
          location: '',
          website: '',
          role: isUserAdmin ? 'admin' : 'user',
          isSuspended: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Write exclusively to the new socialApp profile location
        await createSocialUserProfile(user.uid, newProfile);

        if (isUserAdmin) {
          const adminRef = doc(db, 'admins', user.uid);
          await setDoc(
            adminRef,
            {
              email: user.email,
              role: 'superadmin',
              grantedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        setUserProfile(newProfile);
        setIsAdmin(isUserAdmin);
      } else {
        const adminCheck = isUserAdmin || existingProfile.role === 'admin';
        setUserProfile(existingProfile);
        setIsAdmin(adminCheck);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `socialApp/users/${user.uid}`);
    }
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await syncSocialUserProfile(user);

        // Listen for real-time updates on the separate socialApp profile
        const userRef = getSocialUserDocRef(user.uid);
        const unsubscribeProfile = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              const data = snap.data() as UserProfile;
              const isUserAdmin =
                user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() || data.role === 'admin';
              setUserProfile(data);
              setIsAdmin(isUserAdmin);
            }
          },
          (err) => {
            console.warn('SocialApp user profile listener error:', err);
          }
        );

        setLoading(false);
        return () => {
          unsubscribeProfile();
        };
      } else {
        setUserProfile(null);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const signUpWithEmail = async (email: string, pass: string, name: string, username: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, {
      displayName: name,
      photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${cred.user.uid}`,
    });
    await syncSocialUserProfile(cred.user, name, username);
  };

  const logInWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  // Google Sign-In: works for all previously registered accounts and new registrations
  const logInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    // After login, creates the separate socialApp user profile if it's the first time
    await syncSocialUserProfile(result.user);
  };

  const logOut = async () => {
    await signOut(auth);
    setUserProfile(null);
    setIsAdmin(false);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const updateUserProfile = async (data: Partial<UserProfile>) => {
    if (!currentUser || !userProfile) return;
    try {
      await updateSocialUserProfile(currentUser.uid, data);
      setUserProfile((prev) => (prev ? { ...prev, ...data } : null));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `socialApp/users/${currentUser.uid}`);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        isAdmin,
        loading,
        signUpWithEmail,
        logInWithEmail,
        logInWithGoogle,
        logOut,
        resetPassword,
        updateUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
