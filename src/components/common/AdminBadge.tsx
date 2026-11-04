import React, { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { useAuth, MAIN_ADMIN_UID } from '../../context/AuthContext';
import { doc, onSnapshot } from 'firebase/firestore';
import { ref as rtdbRef, onValue } from 'firebase/database';
import { db, rtdb } from '../../firebase/config';

interface AdminBadgeProps {
  user: {
    uid?: string;
    id?: string;
    role?: 'admin' | 'user';
    adminBadgeVisibility?: 'public' | 'followers' | 'only_me';
  };
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  isFollower?: boolean; // Optional pre-computed follower state
}

export const AdminBadge: React.FC<AdminBadgeProps> = ({
  user,
  size = 'xs',
  className = '',
  isFollower: propIsFollower,
}) => {
  const { currentUser } = useAuth();
  const userId = user.uid || user.id;
  const isOwner = !!(currentUser && userId && currentUser.uid === userId);

  // Authoritative admin check: Main Admin UID UI28ofvzB7cjNJvCG0DvYgbCu9J3 or explicit role
  const isMainAdminUid = userId === MAIN_ADMIN_UID;
  const initialRole = isMainAdminUid ? 'admin' : user.role;

  const [role, setRole] = useState<'admin' | 'user' | undefined>(initialRole);
  const [visibility, setVisibility] = useState<'public' | 'followers' | 'only_me'>(
    user.adminBadgeVisibility || 'public'
  );
  const [isFollowerState, setIsFollowerState] = useState<boolean>(propIsFollower ?? false);

  // Sync props when user object updates
  useEffect(() => {
    if (isMainAdminUid) {
      setRole('admin');
    } else if (user.role !== undefined) {
      setRole(user.role);
    }
    if (user.adminBadgeVisibility !== undefined) {
      setVisibility(user.adminBadgeVisibility);
    }
  }, [user.role, user.adminBadgeVisibility, isMainAdminUid]);

  // Read privacy setting from Realtime Database users/${userId}/adminBadgeVisibility
  useEffect(() => {
    if (!userId) return;

    try {
      const rtdbVisRef = rtdbRef(rtdb, `users/${userId}/adminBadgeVisibility`);
      const unsubRtdb = onValue(
        rtdbVisRef,
        (snap) => {
          const val = snap.val();
          if (val && (val === 'public' || val === 'followers' || val === 'only_me')) {
            setVisibility(val);
          }
        },
        (err) => {
          console.warn('RTDB adminBadgeVisibility notice:', err?.message || err);
        }
      );

      return () => unsubRtdb();
    } catch (e) {
      return () => {};
    }
  }, [userId]);

  // If role is not provided, listen to user doc in Firestore
  useEffect(() => {
    if (!userId || isMainAdminUid || user.role !== undefined) return;

    const userDocRef = doc(db, 'socialApp_users', userId);
    const unsub = onSnapshot(
      userDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.role) setRole(data.role);
          if (data.adminBadgeVisibility) setVisibility(data.adminBadgeVisibility);
        }
      },
      (err) => {
        console.warn('AdminBadge user fetch notice:', err?.message || err);
      }
    );

    return () => unsub();
  }, [userId, user.role, isMainAdminUid]);

  // If visibility is 'followers' and viewer is not the owner and isFollower not provided, verify follower relationship
  useEffect(() => {
    if (role !== 'admin' || isOwner || visibility !== 'followers' || !currentUser || !userId) {
      return;
    }

    if (propIsFollower !== undefined) {
      setIsFollowerState(propIsFollower);
      return;
    }

    const followDocId = `${currentUser.uid}_${userId}`;
    const followRef = doc(db, 'follows', followDocId);
    const unsub = onSnapshot(
      followRef,
      (snap) => {
        setIsFollowerState(snap.exists());
      },
      (error) => {
        console.warn('AdminBadge follower check notice:', error?.message || error);
        setIsFollowerState(false);
      }
    );

    return () => unsub();
  }, [role, isOwner, visibility, currentUser?.uid, userId, propIsFollower]);

  // Non-admins never receive an admin badge
  if (role !== 'admin') {
    return null;
  }

  // 1. Owner can always see their own admin badge (with privacy hint in title)
  if (isOwner) {
    const hint =
      visibility === 'only_me'
        ? 'Admin Badge (Only you can see this)'
        : visibility === 'followers'
        ? 'Admin Badge (Followers only)'
        : 'Admin Badge (Public)';
    return renderBadge(size, className, hint);
  }

  // 2. Only me: hidden from all other viewers
  if (visibility === 'only_me') {
    return null;
  }

  // 3. Followers only: hidden from non-followers
  if (visibility === 'followers' && !isFollowerState) {
    return null;
  }

  // 4. Public or follower passed
  return renderBadge(size, className);
};

function renderBadge(size: 'xs' | 'sm' | 'md', className: string, title?: string) {
  const sizeClasses =
    size === 'xs'
      ? 'text-[10px] px-2 py-0.5 gap-1'
      : size === 'sm'
      ? 'text-xs px-2.5 py-0.5 gap-1.5'
      : 'text-sm px-3 py-1 gap-2';

  const iconSizes = size === 'xs' ? 12 : size === 'sm' ? 14 : 16;

  return (
    <span
      title={title || 'Platform Administrator'}
      className={`inline-flex items-center rounded-full font-bold bg-amber-500/10 text-amber-500 border border-amber-500/25 shrink-0 ${sizeClasses} ${className}`}
    >
      <Shield size={iconSizes} />
      <span>Admin</span>
    </span>
  );
}
