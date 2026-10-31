import React from 'react';
import { Sparkles, Bell, MessageSquare, Sun, Moon, Shield, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
  unreadMessagesCount: number;
  unreadNotificationsCount: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  isDark,
  setIsDark,
  unreadMessagesCount,
  unreadNotificationsCount,
  searchQuery,
  setSearchQuery,
}) => {
  const { userProfile, isAdmin } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full border-b backdrop-blur-md transition-colors bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand / Logo */}
        <div
          onClick={() => setActiveTab('feed')}
          className="flex items-center gap-2.5 cursor-pointer select-none group"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
            <Sparkles size={20} />
          </div>
          <span className="text-xl font-black tracking-tight text-slate-900 dark:text-white hidden sm:inline">
            Pulse<span className="text-indigo-600 dark:text-indigo-400">Wave</span>
          </span>
        </div>

        {/* Global Search Bar */}
        <div className="flex-1 max-w-md mx-2">
          <div className="relative">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search posts, people, #topics..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (activeTab !== 'explore' && e.target.value.trim().length > 0) {
                  setActiveTab('explore');
                }
              }}
              className="w-full pl-10 pr-4 py-2 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>

        {/* Right Header Action Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Dark / Light Toggle */}
          <button
            onClick={() => setIsDark(!isDark)}
            className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Toggle theme"
          >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          {/* Admin shortcut badge if admin */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`p-2 rounded-full transition-colors cursor-pointer relative ${
                activeTab === 'admin'
                  ? 'bg-indigo-600 text-white'
                  : 'text-amber-500 hover:bg-amber-500/10'
              }`}
              title="Admin Dashboard"
            >
              <Shield size={20} />
            </button>
          )}

          {/* Notifications button */}
          <button
            onClick={() => setActiveTab('notifications')}
            className={`p-2 rounded-full relative transition-colors cursor-pointer ${
              activeTab === 'notifications'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Notifications"
          >
            <Bell size={20} />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* Messenger button */}
          <button
            onClick={() => setActiveTab('messenger')}
            className={`p-2 rounded-full relative transition-colors cursor-pointer ${
              activeTab === 'messenger'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Messenger"
          >
            <MessageSquare size={20} />
            {unreadMessagesCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-indigo-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
              </span>
            )}
          </button>

          {/* User Profile Avatar Pill */}
          <button
            onClick={() => setActiveTab('profile')}
            className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <img
              src={userProfile?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=user`}
              alt={userProfile?.displayName || 'User'}
              className="w-8 h-8 rounded-full border border-slate-300 dark:border-slate-700 object-cover"
            />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 hidden md:inline">
              {userProfile?.displayName?.split(' ')[0] || 'Profile'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
