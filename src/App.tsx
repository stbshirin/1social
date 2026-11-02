import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CallProvider } from './context/CallContext';
import { AuthModal } from './components/auth/AuthModal';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { BottomNav } from './components/layout/BottomNav';
import { RightSidebar } from './components/layout/RightSidebar';
import { FeedView } from './components/feed/FeedView';
import { MessengerView } from './components/messenger/MessengerView';
import { ProfileView } from './components/profile/ProfileView';
import { ExploreView } from './components/explore/ExploreView';
import { NotificationsView } from './components/notifications/NotificationsView';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { CallModal } from './components/calling/CallModal';
import { ReportModal } from './components/modals/ReportModal';
import { CreatePostModal } from './components/modals/CreatePostModal';
import { OfflineBanner } from './components/pwa/OfflineBanner';
import { PWAUpdatePrompt } from './components/pwa/PWAUpdatePrompt';
import { TokenServiceNotice } from './components/common/TokenServiceNotice';
import { UserProfile } from './types';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase/config';
import { Sparkles, Ban, LogOut } from 'lucide-react';

const MainApp: React.FC = () => {
  const { currentUser, userProfile, loading, logOut, tokenServiceDisabled } = useAuth();
  const [activeTab, setActiveTab] = useState('feed');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Unread badge counters
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  // Modals
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [reportModalData, setReportModalData] = useState<{ id: string; type: 'post' | 'user' | 'comment' } | null>(null);

  // Navigation targets
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);
  const [initialChatUser, setInitialChatUser] = useState<UserProfile | null>(null);

  // Always enforce 1 social Dark Theme
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Listen to unread notifications
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'notifications'),
      where('recipientId', '==', currentUser.uid),
      where('read', '==', false)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setUnreadNotificationsCount(snapshot.size);
      },
      (error) => {
        console.warn('Notifications listener notice:', error?.message || error);
      }
    );
    return () => unsub();
  }, [currentUser]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600 font-black text-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30 animate-pulse mb-4">
          1
        </div>
        <p className="text-sm font-semibold text-slate-300">Loading 1 social...</p>
      </div>
    );
  }

  // If not authenticated, show Auth Modal
  if (!currentUser) {
    return <AuthModal />;
  }

  // Account Suspended Screen
  if (userProfile?.isSuspended) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950 text-white text-center">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mb-4">
          <Ban size={36} />
        </div>
        <h2 className="text-2xl font-bold mb-2">Account Suspended</h2>
        <p className="text-sm text-slate-400 max-w-sm mb-6">
          Your account has been suspended for violating our platform community guidelines. Please reach out to administrative support.
        </p>
        <button
          onClick={logOut}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
        >
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    );
  }

  const handleStartChatWithUser = (user: UserProfile) => {
    setInitialChatUser(user);
    setActiveTab('messenger');
  };

  const handleViewUserProfile = (userId: string) => {
    setTargetProfileId(userId);
    setActiveTab('profile');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors pb-16 lg:pb-0">
      {tokenServiceDisabled && <TokenServiceNotice />}
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (tab === 'profile') setTargetProfileId(null);
          setActiveTab(tab);
        }}
        unreadMessagesCount={unreadMessagesCount}
        unreadNotificationsCount={unreadNotificationsCount}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      {/* Main Layout Container */}
      <div className="max-w-7xl mx-auto px-2 sm:px-6 flex">
        {/* Left Desktop Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={(tab) => {
            if (tab === 'profile') setTargetProfileId(null);
            setActiveTab(tab);
          }}
          unreadMessagesCount={unreadMessagesCount}
          unreadNotificationsCount={unreadNotificationsCount}
          openCreatePostModal={() => setShowCreatePostModal(true)}
        />

        {/* Center Main Content Area */}
        <main className="flex-1 min-w-0 min-h-[calc(100vh-4rem)]">
          {activeTab === 'feed' && (
            <FeedView
              onOpenReportModal={(id) => setReportModalData({ id, type: 'post' })}
              onViewAuthorProfile={handleViewUserProfile}
              selectedTag={selectedTag}
              onClearTag={() => setSelectedTag(null)}
            />
          )}

          {activeTab === 'messenger' && (
            <MessengerView
              initialChatUser={initialChatUser}
              onClearInitialChatUser={() => setInitialChatUser(null)}
            />
          )}

          {activeTab === 'explore' && (
            <ExploreView
              searchQuery={searchQuery}
              onStartChat={handleStartChatWithUser}
              onViewProfile={handleViewUserProfile}
            />
          )}

          {activeTab === 'notifications' && (
            <NotificationsView
              onNavigateToPost={(id) => {
                setActiveTab('feed');
              }}
              onNavigateToProfile={handleViewUserProfile}
            />
          )}

          {activeTab === 'profile' && (
            <ProfileView
              targetUserId={targetProfileId}
              onOpenReportModal={(id) => setReportModalData({ id, type: 'user' })}
              onStartChat={handleStartChatWithUser}
              onViewAuthorProfile={handleViewUserProfile}
            />
          )}

          {activeTab === 'admin' && <AdminDashboard />}
        </main>

        {/* Right Desktop Sidebar (Only on Feed and Explore) */}
        {(activeTab === 'feed' || activeTab === 'explore') && (
          <RightSidebar
            onStartChat={handleStartChatWithUser}
            onSelectTag={(tag) => {
              setSelectedTag(tag);
              setActiveTab('feed');
            }}
          />
        )}
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (tab === 'profile') setTargetProfileId(null);
          setActiveTab(tab);
        }}
        unreadMessagesCount={unreadMessagesCount}
        openCreatePostModal={() => setShowCreatePostModal(true)}
      />

      {/* WebRTC Audio & Video Calling Modal */}
      <CallModal />

      {/* Report Modal */}
      {reportModalData && (
        <ReportModal
          targetId={reportModalData.id}
          targetType={reportModalData.type}
          onClose={() => setReportModalData(null)}
        />
      )}

      {/* New Post Modal */}
      {showCreatePostModal && (
        <CreatePostModal onClose={() => setShowCreatePostModal(false)} />
      )}

      {/* PWA Offline Banner & Update Prompt */}
      <OfflineBanner />
      <PWAUpdatePrompt />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <CallProvider>
        <MainApp />
      </CallProvider>
    </AuthProvider>
  );
}
