import React, { useEffect, useState } from 'react';
import { Phone, Video, MessageSquare, TrendingUp, UserCheck, UserPlus, Flame } from 'lucide-react';
import { collection, query, limit, onSnapshot, getDocs, doc, setDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { UserProfile, Follow } from '../../types';

import { getSocialUsersCollection } from '../../services/userService';
import { usePresence } from '../../services/presenceService';

interface RightSidebarProps {
  onStartChat: (user: UserProfile) => void;
  onSelectTag?: (tag: string) => void;
}

const QuickConnectUserRow: React.FC<{
  user: UserProfile;
  onStartChat: (user: UserProfile) => void;
  onAudioCall: (user: UserProfile) => void;
  onVideoCall: (user: UserProfile) => void;
}> = ({ user, onStartChat, onAudioCall, onVideoCall }) => {
  const presence = usePresence(user.uid);

  return (
    <div className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group">
      <div
        onClick={() => onStartChat(user)}
        className="flex items-center gap-2.5 cursor-pointer overflow-hidden flex-1 mr-2"
      >
        <div className="relative shrink-0">
          <img
            src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`}
            alt={user.displayName}
            className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700"
          />
          <span
            title={presence.isOnline ? 'Online now' : presence.lastSeenText}
            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
              presence.isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
            }`}
          />
        </div>
        <div className="truncate">
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {user.displayName}
          </p>
          <p className="text-[11px] text-slate-400 truncate">
            {presence.isOnline ? 'Active now' : `@${user.username}`}
          </p>
        </div>
      </div>

      {/* Instant Actions: Audio call, Video call, Chat */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onAudioCall(user)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer"
          title="Audio Call"
        >
          <Phone size={15} />
        </button>
        <button
          onClick={() => onVideoCall(user)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors cursor-pointer"
          title="Video Call"
        >
          <Video size={15} />
        </button>
        <button
          onClick={() => onStartChat(user)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-colors cursor-pointer"
          title="Open Chat"
        >
          <MessageSquare size={15} />
        </button>
      </div>
    </div>
  );
};

export const RightSidebar: React.FC<RightSidebarProps> = ({ onStartChat, onSelectTag }) => {
  const { currentUser } = useAuth();
  const { initiateCall } = useCall();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  // Fetch real socialApp users from Firestore
  useEffect(() => {
    if (!currentUser) return;
    const q = query(getSocialUsersCollection(), limit(15));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as UserProfile))
        .filter((u) => u.uid !== currentUser.uid);
      setUsers(list);
    });

    return () => unsub();
  }, [currentUser]);

  // Track who current user is following
  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'follows'));
    const unsub = onSnapshot(q, (snapshot) => {
      const map: Record<string, boolean> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data() as Follow;
        if (data.followerId === currentUser.uid) {
          map[data.followingId] = true;
        }
      });
      setFollowingMap(map);
    });

    return () => unsub();
  }, [currentUser]);

  const toggleFollow = async (targetUser: UserProfile) => {
    if (!currentUser) return;
    const followDocId = `${currentUser.uid}_${targetUser.uid}`;
    const followRef = doc(db, 'follows', followDocId);

    if (followingMap[targetUser.uid]) {
      await deleteDoc(followRef);
    } else {
      await setDoc(followRef, {
        id: followDocId,
        followerId: currentUser.uid,
        followingId: targetUser.uid,
        createdAt: serverTimestamp(),
      });
    }
  };

  const [trendingTopics, setTrendingTopics] = useState<{ tag: string; count: string }[]>([
    { tag: '#1social', count: 'Featured' },
    { tag: '#trending', count: 'Hot' },
    { tag: '#thoughts', count: 'Feed' },
    { tag: '#community', count: 'Network' },
    { tag: '#tech', count: 'Ideas' },
  ]);

  // Compute real-time trending hashtags from recent posts
  useEffect(() => {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const counts: Record<string, number> = {};
        snapshot.docs.forEach((d) => {
          const text = d.data()?.content || '';
          const tags = text.match(/#[a-zA-Z0-9_\u0980-\u09FF]+/g);
          if (tags) {
            tags.forEach((t: string) => {
              counts[t] = (counts[t] || 0) + 1;
            });
          }
        });
        const sorted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([tag, cnt]) => ({ tag, count: `${cnt} ${cnt === 1 ? 'post' : 'posts'}` }));
        if (sorted.length > 0) {
          setTrendingTopics(sorted.slice(0, 5));
        }
      },
      (error) => {
        console.warn('RightSidebar trending listener notice:', error);
      }
    );
    return () => unsub();
  }, []);

  return (
    <aside className="w-80 shrink-0 hidden xl:flex flex-col gap-6 py-6 pl-6 border-l border-slate-200 dark:border-slate-800 min-h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto">
      {/* Active Contacts with Instant Call buttons */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            Quick Connect & Call
          </h3>
          <span className="text-xs text-slate-400 font-medium">{users.length} available</span>
        </div>

        {users.length === 0 ? (
          <p className="text-xs text-slate-400 py-3 text-center">No other users available yet.</p>
        ) : (
          <div className="space-y-3">
            {users.slice(0, 5).map((u) => (
              <QuickConnectUserRow
                key={u.uid}
                user={u}
                onStartChat={onStartChat}
                onAudioCall={(target) => initiateCall(target, 'audio')}
                onVideoCall={(target) => initiateCall(target, 'video')}
              />
            ))}
          </div>
        )}
      </div>

      {/* Suggested People to Follow */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
          <UserPlus size={16} className="text-indigo-500" />
          Who to follow
        </h3>

        <div className="space-y-3">
          {users.slice(0, 4).map((u) => {
            const isFollowing = !!followingMap[u.uid];
            return (
              <div key={u.uid} className="flex items-center justify-between">
                <div
                  onClick={() => onStartChat(u)}
                  className="flex items-center gap-2.5 cursor-pointer overflow-hidden mr-2"
                >
                  <img
                    src={u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`}
                    alt={u.displayName}
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                  />
                  <div className="truncate">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {u.displayName}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">@{u.username}</p>
                  </div>
                </div>

                <button
                  onClick={() => toggleFollow(u)}
                  className={`text-xs px-3 py-1 rounded-full font-semibold transition-all cursor-pointer ${
                    isFollowing
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                  }`}
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trending Topics */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Flame size={16} className="text-rose-500" />
            Trending on 1 social
          </h3>
          <TrendingUp size={16} className="text-slate-400" />
        </div>

        <div className="space-y-2.5">
          {trendingTopics.map((item) => (
            <div
              key={item.tag}
              onClick={() => onSelectTag?.(item.tag)}
              className="p-2 -mx-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
            >
              <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{item.tag}</p>
              <p className="text-[11px] text-slate-400">{item.count}</p>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};
