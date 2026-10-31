import React, { useState, useEffect } from 'react';
import {
  Edit3,
  MapPin,
  Link as LinkIcon,
  Calendar,
  Grid,
  Heart,
  Image as ImageIcon,
  Phone,
  Video,
  MessageSquare,
  Shield,
  X,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { UserProfile, Post, Follow } from '../../types';
import { PostCard } from '../feed/PostCard';
import { getSocialUserDocRef } from '../../services/userService';

interface ProfileViewProps {
  targetUserId?: string | null;
  onOpenReportModal: (targetId: string) => void;
  onStartChat: (user: UserProfile) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  targetUserId,
  onOpenReportModal,
  onStartChat,
}) => {
  const { currentUser, userProfile: myProfile, updateUserProfile } = useAuth();
  const { initiateCall } = useCall();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'media' | 'likes'>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);

  // Edit Profile Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editPhotoURL, setEditPhotoURL] = useState('');
  const [editCoverURL, setEditCoverURL] = useState('');
  const [saving, setSaving] = useState(false);

  const isMe = !targetUserId || targetUserId === currentUser?.uid;
  const currentUid = targetUserId || currentUser?.uid;

  // Load target profile
  useEffect(() => {
    if (!currentUid) return;

    if (isMe && myProfile) {
      setProfile(myProfile);
      setEditName(myProfile.displayName || '');
      setEditUsername(myProfile.username || '');
      setEditBio(myProfile.bio || '');
      setEditLocation(myProfile.location || '');
      setEditWebsite(myProfile.website || '');
      setEditPhotoURL(myProfile.photoURL || '');
      setEditCoverURL(myProfile.coverURL || '');
      const unsub = onSnapshot(getSocialUserDocRef(currentUid), (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as UserProfile;
          setProfile(data);
        }
      });
      return () => unsub();
    }
  }, [currentUid, isMe, myProfile]);

  // Load posts by this user
  useEffect(() => {
    if (!currentUid) return;
    const q = query(collection(db, 'posts'), where('authorId', '==', currentUid));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Post));
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setPosts(list);
    });
    return () => unsub();
  }, [currentUid]);

  // Load follower and following counts
  useEffect(() => {
    if (!currentUid || !currentUser) return;

    // Followers of this user
    const qFollowers = query(collection(db, 'follows'), where('followingId', '==', currentUid));
    const unsubFollowers = onSnapshot(qFollowers, (snap) => {
      setFollowersCount(snap.size);
      if (!isMe) {
        setIsFollowing(snap.docs.some((d) => (d.data() as Follow).followerId === currentUser.uid));
      }
    });

    // Following by this user
    const qFollowing = query(collection(db, 'follows'), where('followerId', '==', currentUid));
    const unsubFollowing = onSnapshot(qFollowing, (snap) => {
      setFollowingCount(snap.size);
    });

    return () => {
      unsubFollowers();
      unsubFollowing();
    };
  }, [currentUid, currentUser, isMe]);

  const toggleFollow = async () => {
    if (!currentUser || !currentUid || isMe) return;
    const followDocId = `${currentUser.uid}_${currentUid}`;
    const followRef = doc(db, 'follows', followDocId);

    if (isFollowing) {
      await deleteDoc(followRef);
    } else {
      await setDoc(followRef, {
        id: followDocId,
        followerId: currentUser.uid,
        followingId: currentUid,
        createdAt: new Date().toISOString(),
      });
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateUserProfile({
        displayName: editName.trim(),
        username: editUsername.trim().toLowerCase(),
        bio: editBio.trim(),
        location: editLocation.trim(),
        website: editWebsite.trim(),
        photoURL: editPhotoURL.trim(),
        coverURL: editCoverURL.trim(),
      });
      setShowEditModal(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const mediaPosts = posts.filter((p) => p.mediaType !== 'none' && p.mediaUrl);

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-3 sm:px-6">
      {/* Cover Header */}
      <div className="relative h-44 sm:h-64 rounded-3xl overflow-hidden bg-slate-800 border border-slate-200 dark:border-slate-800 shadow-sm">
        <img
          src={
            profile.coverURL ||
            'https://images.unsplash.com/photo-1707343843437-caacff5cfa74?w=1200&auto=format&fit=crop&q=80'
          }
          alt="Cover"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      </div>

      {/* Profile Details Container */}
      <div className="relative px-4 sm:px-8 pb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl -mt-16 z-10 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-end justify-between gap-4 -mt-14 sm:-mt-16 mb-4">
          {/* Avatar with Status */}
          <div className="relative">
            <img
              src={profile.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.uid}`}
              alt={profile.displayName}
              className="w-28 h-28 sm:w-32 sm:h-32 rounded-3xl object-cover border-4 border-white dark:border-slate-900 shadow-xl bg-slate-800"
            />
            <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
          </div>

          {/* Action Buttons: Edit or Follow + Direct Call */}
          <div className="flex items-center gap-2">
            {isMe ? (
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
              >
                <Edit3 size={15} />
                <span>Edit Profile</span>
              </button>
            ) : (
              <>
                <button
                  onClick={toggleFollow}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                    isFollowing
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  {isFollowing ? <UserCheck size={16} /> : <UserPlus size={16} />}
                  <span>{isFollowing ? 'Following' : 'Follow'}</span>
                </button>

                <button
                  onClick={() => onStartChat(profile)}
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                  title="Message"
                >
                  <MessageSquare size={18} />
                </button>

                <button
                  onClick={() => initiateCall(profile, 'audio')}
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:text-emerald-500 transition-colors cursor-pointer"
                  title="Audio Call"
                >
                  <Phone size={18} />
                </button>

                <button
                  onClick={() => initiateCall(profile, 'video')}
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:text-indigo-500 transition-colors cursor-pointer"
                  title="Video Call"
                >
                  <Video size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Name and Meta */}
        <div className="space-y-2 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              {profile.displayName}
            </h1>
            <span className="text-xs text-slate-400 font-mono">@{profile.username}</span>
            {profile.role === 'admin' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 w-fit mx-auto sm:mx-0">
                <Shield size={12} />
                Admin
              </span>
            )}
          </div>

          <p className="text-sm text-slate-700 dark:text-slate-300 max-w-xl">
            {profile.bio || 'PulseWave network member.'}
          </p>

          {/* Location & Links */}
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs text-slate-400 pt-1">
            {profile.location && (
              <div className="flex items-center gap-1">
                <MapPin size={14} />
                <span>{profile.location}</span>
              </div>
            )}
            {profile.website && (
              <a
                href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-indigo-500 hover:underline"
              >
                <LinkIcon size={14} />
                <span>{profile.website}</span>
              </a>
            )}
            <div className="flex items-center gap-1">
              <Calendar size={14} />
              <span>Joined 2026</span>
            </div>
          </div>

          {/* Social Stats: Following and Followers */}
          <div className="flex items-center justify-center sm:justify-start gap-6 pt-3">
            <div className="flex items-center gap-1.5 text-xs sm:text-sm">
              <span className="font-bold text-slate-900 dark:text-white">{followingCount}</span>
              <span className="text-slate-400">Following</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs sm:text-sm">
              <span className="font-bold text-slate-900 dark:text-white">{followersCount}</span>
              <span className="text-slate-400">Followers</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs sm:text-sm">
              <span className="font-bold text-slate-900 dark:text-white">{posts.length}</span>
              <span className="text-slate-400">Posts</span>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Content Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 mb-6">
        <button
          onClick={() => setActiveTab('posts')}
          className={`flex items-center gap-2 py-3 px-5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'posts'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Grid size={16} />
          <span>Posts ({posts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('media')}
          className={`flex items-center gap-2 py-3 px-5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'media'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <ImageIcon size={16} />
          <span>Media ({mediaPosts.length})</span>
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'posts' && (
        <div className="space-y-4">
          {posts.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-10">No posts published yet.</p>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpenReportModal={onOpenReportModal}
              />
            ))
          )}
        </div>
      )}

      {activeTab === 'media' && (
        <div>
          {mediaPosts.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-10">No photos or videos uploaded.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {mediaPosts.map((p) => (
                <div
                  key={p.id}
                  className="aspect-square rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 dark:border-slate-800"
                >
                  {p.mediaType === 'image' ? (
                    <img
                      src={p.mediaUrl}
                      alt="Media"
                      className="w-full h-full object-cover hover:scale-105 transition-transform"
                    />
                  ) : (
                    <video src={p.mediaUrl} className="w-full h-full object-cover" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Edit Profile</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Bio
                </label>
                <textarea
                  rows={2}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Location
                  </label>
                  <input
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    placeholder="e.g. San Francisco, CA"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Website
                  </label>
                  <input
                    type="text"
                    value={editWebsite}
                    onChange={(e) => setEditWebsite(e.target.value)}
                    placeholder="example.com"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Avatar Image URL
                </label>
                <input
                  type="url"
                  value={editPhotoURL}
                  onChange={(e) => setEditPhotoURL(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Cover Banner URL
                </label>
                <input
                  type="url"
                  value={editCoverURL}
                  onChange={(e) => setEditCoverURL(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
