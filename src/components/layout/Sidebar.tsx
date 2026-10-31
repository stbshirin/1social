import React from 'react';
import {
  Home,
  MessageSquare,
  Compass,
  Bell,
  User,
  Shield,
  LogOut,
  PlusCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PWAInstallButton } from '../pwa/PWAInstallButton';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  unreadMessagesCount: number;
  unreadNotificationsCount: number;
  openCreatePostModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  unreadMessagesCount,
  unreadNotificationsCount,
  openCreatePostModal,
}) => {
  const { userProfile, isAdmin, logOut } = useAuth();

  const navItems = [
    { id: 'feed', label: 'Feed', icon: Home },
    { id: 'messenger', label: 'Messenger', icon: MessageSquare, badge: unreadMessagesCount },
    { id: 'explore', label: 'Explore & People', icon: Compass },
    { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotificationsCount },
    { id: 'profile', label: 'My Profile', icon: User },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin Panel', icon: Shield, adminOnly: true }] : []),
  ];

  return (
    <aside className="w-64 shrink-0 hidden lg:flex flex-col justify-between py-6 pr-6 border-r border-slate-200 dark:border-slate-800 min-h-[calc(100vh-4rem)] sticky top-16">
      <div className="space-y-6">
        {/* Navigation list */}
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <Icon size={20} className={isActive ? 'text-white' : item.adminOnly ? 'text-amber-500' : 'text-slate-500 dark:text-slate-400'} />
                  <span>{item.label}</span>
                </div>
                {item.badge && item.badge > 0 ? (
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full font-bold ${
                      isActive ? 'bg-white text-indigo-600' : 'bg-indigo-600 text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Create Post Action Button */}
        <button
          onClick={openCreatePostModal}
          className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition-transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        >
          <PlusCircle size={20} />
          <span>New Post</span>
        </button>

        {/* PWA Install Button */}
        <PWAInstallButton variant="sidebar" />
      </div>

      {/* User profile card & logout */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors">
          <div
            onClick={() => setActiveTab('profile')}
            className="flex items-center gap-3 cursor-pointer overflow-hidden"
          >
            <img
              src={userProfile?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=user`}
              alt="avatar"
              className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
            <div className="truncate">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {userProfile?.displayName}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                @{userProfile?.username}
              </p>
            </div>
          </div>
          <button
            onClick={logOut}
            className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
            title="Log Out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
};
