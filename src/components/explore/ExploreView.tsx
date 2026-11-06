import React, { useState, useEffect } from 'react';
import { Search, UserCheck, UserPlus, Phone, Video, MessageSquare, Compass } from 'lucide-react';
import { collection, query, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { UserProfile, Follow } from '../../types';
import { getSocialUsersCollection } from '../../services/userService';
import { usePresence } from '../../services/presenceService';
import { AdminBadge } from '../common/AdminBadge';

interface ExploreViewProps {
  searchQuery: string;
  onStartChat: (user: UserProfile) => void;
  onViewProfile: (userId: string) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  searchQuery,
  onStartChat,
  onViewProfile,
}) => {
  const { currentUser } = useAuth();
  const { initiateCall } = useCall();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});
  const [localSearch, setLocalSearch] = useState(searchQuery || '');

  // Keep local search updated
  useEffect(() => {
    setLocalSearch(searchQuery || '');
  }, [searchQuery]);

  // Load all socialApp users
  useEffect(() => {
    if (!currentUser) return;
    const q = query(getSocialUsersCollection());
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() } as UserProfile))
          .filter((u) => u.uid !== currentUser.uid);
        setUsers(list);
      },
      (error) => {
        console.warn('Explore users listener notice:', error?.message || error);
      }
    );

    return () => unsub();
  }, [currentUser]);

  // Load follows
  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'follows'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const map: Record<string, boolean> = {};
        snapshot.docs.forEach((d) => {
          const data = d.data() as Follow;
          if (data.followerId === currentUser.uid) {
            map[data.followingId] = true;
          }
        });
        setFollowingMap(map);
      },
      (error) => {
        console.warn('Explore follows listener notice:', error?.message || error);
      }
    );

    return () => unsub();
  }, [currentUser]);

  const toggleFollow = async (u: UserProfile) => {
    if (!currentUser) return;
    const followDocId = `${currentUser.uid}_${u.uid}`;
    const followRef = doc(db, 'follows', followDocId);

    if (followingMap[u.uid]) {
      await deleteDoc(followRef);
    } else {
      await setDoc(followRef, {
        id: followDocId,
        followerId: currentUser.uid,
        followingId: u.uid,
        createdAt: new Date().toISOString(),
      });
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = localSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      u.displayName?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q) ||
      u.bio?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full max-w-3xl mx-auto py-6 px-3 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Compass size={24} className="text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Explore & Discover</h2>
        </div>
        <p className="text-xs text-slate-400">
          Find people, start real-time conversations, and connect via HD WebRTC video & audio calls.
        </p>
      </div>

      {/* Search Input */}
      <div className="relative mb-6">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search by full name, username, or interests..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {filteredUsers.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-400 text-xs">
            No users found matching "{localSearch}".
          </div>
        ) : (
          filteredUsers.map((u) => (
            <ExploreUserCard
              key={u.uid}
              user={u}
              isFollowing={!!followingMap[u.uid]}
              onToggleFollow={() => toggleFollow(u)}
              onViewProfile={onViewProfile}
              onStartChat={onStartChat}
              onInitiateCall={initiateCall}
            />
          ))
        )}
      </div>
    </div>
  );
};

interface ExploreUserCardProps {
  user: UserProfile;
  isFollowing: boolean;
  onToggleFollow: () => void;
  onViewProfile: (userId: string) => void;
  onStartChat: (user: UserProfile) => void;
  onInitiateCall: (user: UserProfile, type: 'audio' | 'video') => void;
}

const ExploreUserCard: React.FC<ExploreUserCardProps> = ({
  user,
  isFollowing,
  onToggleFollow,
  onViewProfile,
  onStartChat,
  onInitiateCall,
}) => {
  const presence = usePresence(user.uid);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col justify-between transition-all hover:border-slate-300 dark:hover:border-slate-700">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          onClick={() => onViewProfile(user.uid)}
          className="flex items-center gap-3 cursor-pointer overflow-hidden flex-1"
        >
          <div className="relative shrink-0">
            <img
              src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`}
              alt={user.displayName}
              className="w-12 h-12 rounded-full object-cover border border-slate-200 dark:border-slate-700"
            />
            {/* Dynamic Presence Dot */}
            <span
              title={presence.isOnline ? 'Online' : presence.lastSeenText}
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                presence.isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
              }`}
            />
          </div>
          <div className="truncate flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {user.displayName}
              </h4>
              <AdminBadge user={user} isFollower={isFollowing} size="xs" />
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <span className="truncate">@{user.username}</span>
              <span>•</span>
              <span className={presence.isOnline ? 'text-emerald-500 font-medium' : 'text-slate-400'}>
                {presence.isOnline ? 'Online' : presence.lastSeenText}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onToggleFollow}
          className={`text-xs px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer shrink-0 ${
            isFollowing
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-rose-50 hover:text-rose-600'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
          }`}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </button>
      </div>

      {user.bio && (
        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mb-3">
          {user.bio}
        </p>
      )}

      {/* Instant Action Bar */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <button
          onClick={() => onStartChat(user)}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
        >
          <MessageSquare size={15} />
          <span>Chat</span>
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onInitiateCall(user, 'audio')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer"
            title="Audio Call"
          >
            <Phone size={16} />
          </button>
          <button
            onClick={() => onInitiateCall(user, 'video')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors cursor-pointer"
            title="Video Call"
          >
            <Video size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
