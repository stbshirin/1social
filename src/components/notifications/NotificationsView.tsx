import React, { useState, useEffect } from 'react';
import {
  Bell,
  Heart,
  MessageCircle,
  UserPlus,
  Phone,
  Video,
  Check,
  Trash2,
  CheckCheck,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { NotificationItem } from '../../types';

interface NotificationsViewProps {
  onNavigateToPost?: (postId: string) => void;
  onNavigateToProfile?: (userId: string) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  onNavigateToPost,
  onNavigateToProfile,
}) => {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'notifications'),
      where('recipientId', '==', currentUser.uid)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as NotificationItem));
        list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        setNotifications(list);
        setLoading(false);
      },
      (error) => {
        console.warn('Notifications listener notice:', error?.message || error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUser]);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (e) {
      console.warn('Error marking notification as read:', e);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unreadList = notifications.filter((n) => !n.read);
      for (const n of unreadList) {
        await updateDoc(doc(db, 'notifications', n.id), { read: true });
      }
    } catch (e) {
      console.warn('Error marking all as read:', e);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (e) {
      console.warn('Error deleting notification:', e);
    }
  };

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'like':
        return <Heart size={16} className="text-rose-500 fill-rose-500" />;
      case 'comment':
        return <MessageCircle size={16} className="text-indigo-500" />;
      case 'follow':
        return <UserPlus size={16} className="text-emerald-500" />;
      case 'call':
        return <Phone size={16} className="text-amber-500" />;
      default:
        return <Bell size={16} className="text-indigo-500" />;
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-6 px-3 sm:px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Bell size={22} className="text-indigo-600 dark:text-indigo-400" />
            Notifications
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Stay updated with your social activities</p>
        </div>

        {notifications.some((n) => !n.read) && (
          <button
            onClick={markAllAsRead}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            <CheckCheck size={16} />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse"
            />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-10 text-center shadow-sm">
          <Bell size={32} className="mx-auto text-slate-400 mb-3" />
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
            No notifications yet
          </h4>
          <p className="text-xs text-slate-400">
            When you receive likes, comments, calls or new followers, they will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => {
                if (!n.read) markAsRead(n.id);
                if (n.type === 'like' || n.type === 'comment') {
                  if (n.link) onNavigateToPost?.(n.link);
                } else if (n.type === 'follow') {
                  onNavigateToProfile?.(n.senderId);
                }
              }}
              className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                !n.read
                  ? 'bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/60'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="relative shrink-0">
                  <img
                    src={n.senderPhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${n.senderId}`}
                    alt="sender"
                    className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                  />
                  <span className="absolute -bottom-1 -right-1 p-1 rounded-full bg-white dark:bg-slate-800 shadow-sm">
                    {getIcon(n.type)}
                  </span>
                </div>

                <div className="truncate">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {n.content}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {n.createdAt ? new Date(n.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Recently'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!n.read && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      markAsRead(n.id);
                    }}
                    className="p-1 text-indigo-600 hover:text-indigo-700 cursor-pointer"
                    title="Mark as read"
                  >
                    <Check size={16} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNotification(n.id);
                  }}
                  className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                  title="Delete notification"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
