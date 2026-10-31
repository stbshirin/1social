import React from 'react';
import { Home, Compass, Plus, MessageSquare, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  unreadMessagesCount: number;
  openCreatePostModal: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  setActiveTab,
  unreadMessagesCount,
  openCreatePostModal,
}) => {
  const { userProfile } = useAuth();

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 backdrop-blur-lg px-2 py-2 flex items-center justify-around">
      <button
        onClick={() => setActiveTab('feed')}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors cursor-pointer ${
          activeTab === 'feed'
            ? 'text-indigo-600 dark:text-indigo-400'
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        <Home size={22} />
        <span className="text-[10px] font-medium">Feed</span>
      </button>

      <button
        onClick={() => setActiveTab('explore')}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors cursor-pointer ${
          activeTab === 'explore'
            ? 'text-indigo-600 dark:text-indigo-400'
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        <Compass size={22} />
        <span className="text-[10px] font-medium">Explore</span>
      </button>

      {/* Floating Plus Button for creating post */}
      <button
        onClick={openCreatePostModal}
        className="w-12 h-12 -mt-5 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
        title="Create Post"
      >
        <Plus size={24} />
      </button>

      <button
        onClick={() => setActiveTab('messenger')}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors relative cursor-pointer ${
          activeTab === 'messenger'
            ? 'text-indigo-600 dark:text-indigo-400'
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        <MessageSquare size={22} />
        {unreadMessagesCount > 0 && (
          <span className="absolute top-1.5 right-2 w-4 h-4 bg-indigo-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
          </span>
        )}
        <span className="text-[10px] font-medium">Chats</span>
      </button>

      <button
        onClick={() => setActiveTab('profile')}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors cursor-pointer ${
          activeTab === 'profile'
            ? 'text-indigo-600 dark:text-indigo-400'
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        {userProfile?.photoURL ? (
          <img
            src={userProfile.photoURL}
            alt="me"
            className="w-5 h-5 rounded-full object-cover border border-slate-300 dark:border-slate-700"
          />
        ) : (
          <User size={22} />
        )}
        <span className="text-[10px] font-medium">Profile</span>
      </button>
    </nav>
  );
};
