import React, { useState, useEffect, useRef } from 'react';
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
  User as UserIcon,
  ArrowLeft,
  Camera,
  Upload,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { UserProfile, Post, Follow } from '../../types';
import { PostCard } from '../feed/PostCard';
import { getSocialUserDocRef, fetchSocialUserProfile } from '../../services/userService';
import { uploadUserProfileImage } from '../../services/storageService';
import { usePresence } from '../../services/presenceService';
import { AdminBadge } from '../common/AdminBadge';

interface ProfileViewProps {
  targetUserId?: string | null;
  onOpenReportModal: (targetId: string) => void;
  onStartChat: (user: UserProfile) => void;
  onViewAuthorProfile?: (userId: string) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  targetUserId,
  onOpenReportModal,
  onStartChat,
  onViewAuthorProfile,
}) => {
  const { currentUser, userProfile: myProfile, updateUserProfile } = useAuth();
  const { initiateCall } = useCall();

  const isMe = !targetUserId || targetUserId === currentUser?.uid;
  const currentUid = targetUserId || currentUser?.uid;

  const [profile, setProfile] = useState<UserProfile | null>(isMe ? myProfile : null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(!isMe || !myProfile);
  const [profileNotFound, setProfileNotFound] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'posts' | 'media' | 'likes'>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);

  // Social Lists Modal (Followers / Following)
  const [followModalType, setFollowModalType] = useState<'followers' | 'following' | null>(null);
  const [followListUsers, setFollowListUsers] = useState<UserProfile[]>([]);
  const [loadingFollowList, setLoadingFollowList] = useState(false);

  // Real-time online/offline presence for the active profile
  const presence = usePresence(currentUid);

  // Direct file upload state for avatar & cover photo
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarProgress, setAvatarProgress] = useState<number | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverProgress, setCoverProgress] = useState<number | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Edit Profile Modal state (strictly for isMe)
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editPhotoURL, setEditPhotoURL] = useState('');
  const [editCoverURL, setEditCoverURL] = useState('');
  const [editBadgeVisibility, setEditBadgeVisibility] = useState<'public' | 'followers' | 'only_me'>('public');
  const [saving, setSaving] = useState(false);

  // Handle direct file uploads from the profile banner / avatar camera buttons
  const handleDirectAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setUploadingAvatar(true);
    setAvatarProgress(1);
    setUploadNotice(null);

    try {
      const downloadUrl = await uploadUserProfileImage(
        currentUser.uid,
        file,
        'avatar',
        (p) => setAvatarProgress(p)
      );
      await updateUserProfile({ photoURL: downloadUrl });
      setEditPhotoURL(downloadUrl);
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      setUploadNotice(err.message || 'Avatar upload failed.');
    } finally {
      setUploadingAvatar(false);
      setAvatarProgress(null);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleDirectCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setUploadingCover(true);
    setCoverProgress(1);
    setUploadNotice(null);

    try {
      const downloadUrl = await uploadUserProfileImage(
        currentUser.uid,
        file,
        'cover',
        (p) => setCoverProgress(p)
      );
      await updateUserProfile({ coverURL: downloadUrl });
      setEditCoverURL(downloadUrl);
    } catch (err: any) {
      console.error('Cover upload error:', err);
      setUploadNotice(err.message || 'Cover banner upload failed.');
    } finally {
      setUploadingCover(false);
      setCoverProgress(null);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  // Load target profile whenever currentUid changes
  useEffect(() => {
    if (!currentUid) return;

    let isMounted = true;
    setProfileNotFound(false);

    // If switching to another user's profile, immediately clear previous/stale profile
    if (!isMe) {
      setProfile(null);
      setPosts([]);
      setFollowersCount(0);
      setFollowingCount(0);
      setIsFollowing(false);
      setLoadingProfile(true);
    } else if (myProfile) {
      setProfile(myProfile);
      setEditName(myProfile.displayName || '');
      setEditUsername(myProfile.username || '');
      setEditBio(myProfile.bio || '');
      setEditLocation(myProfile.location || '');
      setEditWebsite(myProfile.website || '');
      setEditPhotoURL(myProfile.photoURL || '');
      setEditCoverURL(myProfile.coverURL || '');
      setEditBadgeVisibility(myProfile.adminBadgeVisibility || 'public');
      setLoadingProfile(false);
    }

    // Set up real-time listener for currentUid document
    const userDocRef = getSocialUserDocRef(currentUid);
    const unsub = onSnapshot(
      userDocRef,
      async (snap) => {
        if (!isMounted) return;

        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as UserProfile;
          setProfile(data);
          setProfileNotFound(false);
          setLoadingProfile(false);

          if (isMe) {
            setEditName(data.displayName || '');
            setEditUsername(data.username || '');
            setEditBio(data.bio || '');
            setEditLocation(data.location || '');
            setEditWebsite(data.website || '');
            setEditPhotoURL(data.photoURL || '');
            setEditCoverURL(data.coverURL || '');
            setEditBadgeVisibility(data.adminBadgeVisibility || 'public');
          }
        } else {
          // If not in direct collection yet, try fallback service
          try {
            const fallback = await fetchSocialUserProfile(currentUid);
            if (!isMounted) return;

            if (fallback) {
              setProfile(fallback);
              setProfileNotFound(false);
              setLoadingProfile(false);
            } else {
              // Check legacy users collection as last fallback
              const legacySnap = await getDoc(doc(db, 'users', currentUid));
              if (!isMounted) return;

              if (legacySnap.exists()) {
                const lData = legacySnap.data() as any;
                const converted: UserProfile = {
                  id: currentUid,
                  uid: currentUid,
                  email: lData.email || '',
                  displayName: lData.displayName || lData.name || 'User',
                  username: lData.username || `user_${currentUid.slice(0, 5)}`,
                  photoURL: lData.photoURL || lData.avatarUrl || '',
                  coverURL: lData.coverURL || '',
                  bio: lData.bio || '',
                  location: lData.location || '',
                  website: lData.website || '',
                  role: 'user',
                  createdAt: lData.createdAt || new Date().toISOString(),
                  updatedAt: lData.updatedAt || new Date().toISOString(),
                };
                setProfile(converted);
                setProfileNotFound(false);
              } else {
                setProfileNotFound(true);
              }
              setLoadingProfile(false);
            }
          } catch (err) {
            if (!isMounted) return;
            console.warn('Profile fallback fetch notice:', err);
            setProfileNotFound(true);
            setLoadingProfile(false);
          }
        }
      },
      (error) => {
        if (!isMounted) return;
        console.warn('Profile listener notice:', error?.message || error);
        setLoadingProfile(false);
      }
    );

    return () => {
      isMounted = false;
      unsub();
    };
  }, [currentUid, isMe, myProfile]);

  // Load posts by this user
  useEffect(() => {
    if (!currentUid) return;
    const q = query(collection(db, 'posts'), where('authorId', '==', currentUid));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Post));
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setPosts(list);
      },
      (error) => {
        console.warn('User posts listener notice:', error?.message || error);
      }
    );
    return () => unsub();
  }, [currentUid]);

  // Real-time listener for whether current user is following this user
  useEffect(() => {
    if (!currentUid || !currentUser || isMe) {
      setIsFollowing(false);
      return;
    }

    const followDocId = `${currentUser.uid}_${currentUid}`;
    const followRef = doc(db, 'follows', followDocId);
    const unsub = onSnapshot(
      followRef,
      (snap) => {
        setIsFollowing(snap.exists());
      },
      (error) => {
        console.warn('Follow state listener notice:', error?.message || error);
      }
    );

    return () => unsub();
  }, [currentUid, currentUser?.uid, isMe]);

  // Load follower and following counts
  useEffect(() => {
    if (!currentUid) return;

    // Followers of this user
    const qFollowers = query(collection(db, 'follows'), where('followingId', '==', currentUid));
    const unsubFollowers = onSnapshot(
      qFollowers,
      (snap) => {
        setFollowersCount(snap.size);
      },
      (error) => {
        console.warn('Followers listener notice:', error?.message || error);
      }
    );

    // Following by this user
    const qFollowing = query(collection(db, 'follows'), where('followerId', '==', currentUid));
    const unsubFollowing = onSnapshot(
      qFollowing,
      (snap) => {
        setFollowingCount(snap.size);
      },
      (error) => {
        console.warn('Following listener notice:', error?.message || error);
      }
    );

    return () => {
      unsubFollowers();
      unsubFollowing();
    };
  }, [currentUid]);

  // Toggle follow/unfollow
  const toggleFollow = async () => {
    if (!currentUser || !currentUid || isMe) return;
    const followDocId = `${currentUser.uid}_${currentUid}`;
    const followRef = doc(db, 'follows', followDocId);

    if (isFollowing) {
      setIsFollowing(false);
      setFollowersCount((prev) => Math.max(0, prev - 1));
      try {
        await deleteDoc(followRef);
      } catch (e) {
        console.warn('Error deleting follow record:', e);
      }
    } else {
      setIsFollowing(true);
      setFollowersCount((prev) => prev + 1);
      try {
        await setDoc(followRef, {
          id: followDocId,
          followerId: currentUser.uid,
          followingId: currentUid,
          createdAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Error setting follow record:', e);
      }
    }
  };

  // Open modal for followers or following list
  const openFollowModal = async (type: 'followers' | 'following') => {
    setFollowModalType(type);
    setLoadingFollowList(true);
    setFollowListUsers([]);

    try {
      const q =
        type === 'followers'
          ? query(collection(db, 'follows'), where('followingId', '==', currentUid))
          : query(collection(db, 'follows'), where('followerId', '==', currentUid));

      const snap = await getDocs(q);
      const userIds = snap.docs.map((d) => {
        const data = d.data();
        return type === 'followers' ? data.followerId : data.followingId;
      });

      if (userIds.length === 0) {
        setFollowListUsers([]);
        setLoadingFollowList(false);
        return;
      }

      // Fetch user profile previews for these userIds
      const fetched: UserProfile[] = [];
      for (const uid of userIds) {
        try {
          const directRef = getSocialUserDocRef(uid);
          const uSnap = await getDoc(directRef);
          if (uSnap.exists()) {
            fetched.push({ id: uSnap.id, ...uSnap.data() } as UserProfile);
          } else {
            const fallback = await fetchSocialUserProfile(uid);
            if (fallback) fetched.push(fallback);
          }
        } catch (e) {
          console.warn('Error fetching follow list user:', e);
        }
      }

      setFollowListUsers(fetched);
    } catch (err) {
      console.warn('Error loading follow list:', err);
    } finally {
      setLoadingFollowList(false);
    }
  };

  // Save profile changes (strictly for authenticated user's own profile)
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMe) return;

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
        adminBadgeVisibility: editBadgeVisibility,
      });
      setShowEditModal(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // User Profile Not Found UI
  if (profileNotFound) {
    return (
      <div className="w-full max-w-xl mx-auto py-16 px-4 text-center animate-in fade-in duration-200">
        <div className="w-16 h-16 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-4">
          <UserIcon size={32} />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">User Not Found</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
          This user profile could not be found or has not been created yet in 1 social.
        </p>
        {onViewAuthorProfile && currentUser && (
          <button
            onClick={() => onViewAuthorProfile(currentUser.uid)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition-colors cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Go to My Profile</span>
          </button>
        )}
      </div>
    );
  }

  // Profile Loading Spinner
  if (loadingProfile && !profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-slate-400 font-medium">Loading profile...</span>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const mediaPosts = posts.filter((p) => p.mediaType !== 'none' && p.mediaUrl);

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-3 sm:px-6">
      {/* Hidden file inputs for direct upload */}
      {isMe && (
        <>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleDirectAvatarUpload}
          />
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleDirectCoverUpload}
          />
        </>
      )}

      {/* Cover Header */}
      <div className="relative h-44 sm:h-64 rounded-3xl overflow-hidden bg-slate-800 border border-slate-200 dark:border-slate-800 shadow-sm group">
        <img
          src={
            profile.coverURL ||
            'https://images.unsplash.com/photo-1707343843437-caacff5cfa74?w=1200&auto=format&fit=crop&q=80'
          }
          alt="Cover"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Change Cover Button for current user */}
        {isMe && (
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={uploadingCover}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/60 hover:bg-black/80 backdrop-blur text-white text-xs font-semibold shadow-md transition-all cursor-pointer z-10"
            title="Upload new cover banner"
          >
            <Camera size={14} />
            <span>{uploadingCover ? `Uploading ${coverProgress || 0}%` : 'Change Cover'}</span>
          </button>
        )}
      </div>

      {/* Upload notice if any */}
      {uploadNotice && (
        <div className="mt-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-xs text-center font-medium">
          {uploadNotice}
        </div>
      )}

      {/* Profile Details Container */}
      <div className="relative px-4 sm:px-8 pb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl -mt-16 z-10 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-end justify-between gap-4 -mt-14 sm:-mt-16 mb-4">
          {/* Avatar with Status & Direct Camera Trigger */}
          <div className="relative">
            <img
              src={profile.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.uid}`}
              alt={profile.displayName}
              className="w-28 h-28 sm:w-32 sm:h-32 rounded-3xl object-cover border-4 border-white dark:border-slate-900 shadow-xl bg-slate-800"
            />
            {isMe && (
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute top-1 right-1 p-2 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white shadow-lg transition-transform active:scale-95 cursor-pointer z-10"
                title="Upload new profile picture"
              >
                <Camera size={14} />
              </button>
            )}

            {/* Real-time Presence Indicator */}
            <span
              title={presence.isOnline ? 'Online now' : presence.lastSeenText}
              className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 ${
                presence.isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
              }`}
            />
          </div>

          {/* Action Buttons: Edit (for me) or Follow + Chat + Call (for other users) */}
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
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600'
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

        {/* Name, Presence Text, and Admin Badge */}
        <div className="space-y-2 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              {profile.displayName}
            </h1>
            <span className="text-xs text-slate-400 font-mono">@{profile.username}</span>
            <AdminBadge user={profile} isFollower={isFollowing} size="sm" />
          </div>

          {/* Real-time status subtitle */}
          <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                presence.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400 dark:bg-slate-500'
              }`}
            />
            <span className={presence.isOnline ? 'text-emerald-500 font-semibold' : 'text-slate-400'}>
              {presence.lastSeenText}
            </span>
          </div>

          <p className="text-sm text-slate-700 dark:text-slate-300 max-w-xl">
            {profile.bio || '1 social network member.'}
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

          {/* Social Stats: Clickable Following and Followers lists */}
          <div className="flex items-center justify-center sm:justify-start gap-6 pt-3">
            <button
              onClick={() => openFollowModal('following')}
              className="flex items-center gap-1.5 text-xs sm:text-sm hover:opacity-80 transition-opacity cursor-pointer group"
              title="View following"
            >
              <span className="font-bold text-slate-900 dark:text-white group-hover:text-indigo-500">
                {followingCount}
              </span>
              <span className="text-slate-400">Following</span>
            </button>

            <button
              onClick={() => openFollowModal('followers')}
              className="flex items-center gap-1.5 text-xs sm:text-sm hover:opacity-80 transition-opacity cursor-pointer group"
              title="View followers"
            >
              <span className="font-bold text-slate-900 dark:text-white group-hover:text-indigo-500">
                {followersCount}
              </span>
              <span className="text-slate-400">Followers</span>
            </button>

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
                onViewAuthorProfile={onViewAuthorProfile}
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

      {/* Followers / Following List Modal */}
      {followModalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                {followModalType}
              </h3>
              <button
                onClick={() => setFollowModalType(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2">
              {loadingFollowList ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : followListUsers.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  No {followModalType} yet.
                </p>
              ) : (
                followListUsers.map((u) => (
                  <div
                    key={u.uid}
                    onClick={() => {
                      setFollowModalType(null);
                      onViewAuthorProfile?.(u.uid);
                    }}
                    className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <img
                      src={u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`}
                      alt={u.displayName}
                      className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                    />
                    <div className="truncate">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {u.displayName}
                      </p>
                      <p className="text-xs text-slate-400 truncate">@{u.username}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal (Strictly for Own Profile) */}
      {showEditModal && isMe && (
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

              {/* Avatar Image with File Upload or Direct URL */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Profile Picture (Avatar)
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="url"
                    value={editPhotoURL}
                    onChange={(e) => setEditPhotoURL(e.target.value)}
                    placeholder="https://... or choose a local file"
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                  />
                  <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 text-xs font-semibold cursor-pointer shrink-0 border border-indigo-200 dark:border-indigo-800">
                    <Upload size={14} />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !currentUser) return;
                        setSaving(true);
                        try {
                          const url = await uploadUserProfileImage(currentUser.uid, file, 'avatar');
                          setEditPhotoURL(url);
                        } catch (err: any) {
                          alert(err.message || 'Avatar upload failed');
                        } finally {
                          setSaving(false);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Cover Banner with File Upload or Direct URL */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Cover Photo Banner
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="url"
                    value={editCoverURL}
                    onChange={(e) => setEditCoverURL(e.target.value)}
                    placeholder="https://... or choose a local file"
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                  />
                  <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 text-xs font-semibold cursor-pointer shrink-0 border border-indigo-200 dark:border-indigo-800">
                    <Upload size={14} />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !currentUser) return;
                        setSaving(true);
                        try {
                          const url = await uploadUserProfileImage(currentUser.uid, file, 'cover');
                          setEditCoverURL(url);
                        } catch (err: any) {
                          alert(err.message || 'Cover upload failed');
                        } finally {
                          setSaving(false);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Admin Badge Visibility Privacy Setting (strictly for Admins) */}
              {(profile.role === 'admin' || myProfile?.role === 'admin') && (
                <div className="p-3.5 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Shield size={16} className="text-amber-500" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Admin Badge Privacy
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Choose who can see your Administrator badge across the app (Profile, Feed, Comments, Explore).
                  </p>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { value: 'public', label: 'Public', desc: 'Everyone' },
                      { value: 'followers', label: 'Followers', desc: 'Followers only' },
                      { value: 'only_me', label: 'Only Me', desc: 'Private' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setEditBadgeVisibility(opt.value as any)}
                        className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                          editBadgeVisibility === opt.value
                            ? 'border-amber-500 bg-amber-500/10 text-amber-500 ring-1 ring-amber-500'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="text-xs font-bold">{opt.label}</div>
                        <div className="text-[10px] opacity-75">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
