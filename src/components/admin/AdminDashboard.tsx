import React, { useState, useEffect } from 'react';
import {
  Shield,
  Users,
  FileText,
  AlertTriangle,
  CheckCircle,
  Ban,
  Trash2,
  PhoneCall,
  Search,
} from 'lucide-react';
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { UserProfile, Post, ReportItem, CallSession } from '../../types';
import { getSocialUsersCollection, updateSocialUserProfile } from '../../services/userService';

export const AdminDashboard: React.FC = () => {
  const { isAdmin, currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'posts' | 'reports' | 'calls'>('users');

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [calls, setCalls] = useState<CallSession[]>([]);

  const [userSearch, setUserSearch] = useState('');
  const [postSearch, setPostSearch] = useState('');

  // Real-time listener for socialApp users
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(getSocialUsersCollection(), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserProfile)));
    });
    return () => unsub();
  }, [isAdmin]);

  // Real-time listener for posts
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(collection(db, 'posts'), (snap) => {
      setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Post)));
    });
    return () => unsub();
  }, [isAdmin]);

  // Real-time listener for reports
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(collection(db, 'reports'), (snap) => {
      setReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReportItem)));
    });
    return () => unsub();
  }, [isAdmin]);

  // Real-time listener for calls
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(collection(db, 'calls'), (snap) => {
      setCalls(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CallSession)));
    });
    return () => unsub();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="w-full max-w-md mx-auto my-16 p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm">
        <Shield size={44} className="mx-auto text-rose-500 mb-3" />
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Access Restricted</h3>
        <p className="text-xs text-slate-400">
          This administrative moderation panel is strictly reserved for authorized administrators.
        </p>
      </div>
    );
  }

  // Admin Actions
  const toggleSuspendUser = async (u: UserProfile) => {
    try {
      await updateSocialUserProfile(u.uid, {
        isSuspended: !u.isSuspended,
      });
    } catch (e) {
      console.warn('Error updating suspension:', e);
    }
  };

  const deletePostAsAdmin = async (postId: string) => {
    if (!window.confirm('Delete this post immediately across the platform?')) return;
    try {
      await deleteDoc(doc(db, 'posts', postId));
    } catch (e) {
      console.warn('Error deleting post as admin:', e);
    }
  };

  const handleResolveReport = async (reportId: string, status: 'resolved' | 'dismissed') => {
    try {
      await updateDoc(doc(db, 'reports', reportId), {
        status,
        resolvedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Error resolving report:', e);
    }
  };

  const pendingReports = reports.filter((r) => r.status === 'pending');

  return (
    <div className="w-full max-w-5xl mx-auto py-6 px-3 sm:px-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-900/50 rounded-3xl p-6 text-white mb-8 shadow-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-2xl bg-indigo-600/30 border border-indigo-500/30 text-indigo-400">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold">PulseWave Admin & Moderation Center</h1>
            <p className="text-xs text-indigo-200/70">
              Logged in as verified administrator ({currentUser?.email})
            </p>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-indigo-300 text-xs font-medium mb-1">
              <Users size={16} />
              <span>Registered Users</span>
            </div>
            <p className="text-2xl font-black">{users.length}</p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-indigo-300 text-xs font-medium mb-1">
              <FileText size={16} />
              <span>Total Posts</span>
            </div>
            <p className="text-2xl font-black">{posts.length}</p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-medium mb-1">
              <AlertTriangle size={16} />
              <span>Pending Reports</span>
            </div>
            <p className="text-2xl font-black text-amber-400">{pendingReports.length}</p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-medium mb-1">
              <PhoneCall size={16} />
              <span>Logged Calls</span>
            </div>
            <p className="text-2xl font-black text-emerald-400">{calls.length}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 mb-6">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all cursor-pointer ${
            activeTab === 'users'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Users ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('posts')}
          className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all cursor-pointer ${
            activeTab === 'posts'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Posts ({posts.length})
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all cursor-pointer relative ${
            activeTab === 'reports'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Reports
          {pendingReports.length > 0 && (
            <span className="ml-1.5 px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
              {pendingReports.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('calls')}
          className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all cursor-pointer ${
            activeTab === 'calls'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          WebRTC Sessions ({calls.length})
        </button>
      </div>

      {/* Users Tab Table */}
      {activeTab === 'users' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Registered Users</h3>
            <div className="relative w-60">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search user..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-400 uppercase border-b border-slate-200 dark:border-slate-800 font-semibold">
                <tr>
                  <th className="p-4">User</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {users
                  .filter((u) => u.displayName?.toLowerCase().includes(userSearch.toLowerCase()) || u.email?.toLowerCase().includes(userSearch.toLowerCase()))
                  .map((u) => (
                    <tr key={u.uid} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="p-4 flex items-center gap-3">
                        <img
                          src={u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`}
                          alt={u.displayName}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white">{u.displayName}</p>
                          <p className="text-[10px] text-slate-400">@{u.username} • {u.email}</p>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          u.role === 'admin' ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}>
                          {u.role || 'user'}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          u.isSuspended ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'
                        }`}>
                          {u.isSuspended ? 'Suspended' : 'Active'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => toggleSuspendUser(u)}
                          className={`px-3 py-1 rounded-xl font-semibold transition-colors cursor-pointer ${
                            u.isSuspended
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              : 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 hover:bg-rose-100'
                          }`}
                        >
                          {u.isSuspended ? 'Reactivate' : 'Suspend'}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Posts Tab Moderation */}
      {activeTab === 'posts' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Platform Posts</h3>
            <div className="relative w-60">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search post text..."
                value={postSearch}
                onChange={(e) => setPostSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {posts
              .filter((p) => p.content?.toLowerCase().includes(postSearch.toLowerCase()))
              .map((p) => (
                <div key={p.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-900 dark:text-white">{p.authorName}</span>
                      <span className="text-[10px] text-slate-400">@{p.authorUsername}</span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2">{p.content}</p>
                    {p.mediaUrl && (
                      <span className="inline-block mt-1 text-[10px] text-indigo-500">
                        Attachment: {p.mediaType}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => deletePostAsAdmin(p.id)}
                    className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors cursor-pointer"
                    title="Remove post"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Flagged Content Reports</h3>
          </div>

          {reports.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">No reports submitted.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {reports.map((r) => (
                <div key={r.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500">
                        {r.targetType.toUpperCase()}
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{r.reason}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{r.details || 'No additional details provided.'}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Status: <span className="font-semibold">{r.status}</span></p>
                  </div>

                  {r.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleResolveReport(r.id, 'resolved')}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
                      >
                        Action / Resolve
                      </button>
                      <button
                        onClick={() => handleResolveReport(r.id, 'dismissed')}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* WebRTC Calls Tab */}
      {activeTab === 'calls' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">WebRTC Call Signaling Log</h3>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {calls.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">No call sessions recorded yet.</div>
            ) : (
              calls.map((c) => (
                <div key={c.id} className="p-4 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">
                      {c.callerName} ➔ {c.calleeName}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Type: {c.type} • Status: <span className="font-semibold text-indigo-400">{c.status}</span>
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {c.duration ? `${c.duration}s` : 'Session ID: ' + c.id.slice(0, 6)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
