import React, { useState, useEffect } from 'react';
import {
  Heart,
  MessageCircle,
  Share2,
  MoreHorizontal,
  Trash2,
  Edit2,
  Flag,
  Send,
  Check,
  CornerDownRight,
} from 'lucide-react';
import {
  doc,
  deleteDoc,
  updateDoc,
  setDoc,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { Post, Comment, Like } from '../../types';
import { handleFirestoreError, OperationType } from '../../firebase/errorHandler';

interface PostCardProps {
  post: Post;
  onOpenReportModal: (postId: string) => void;
  onViewAuthorProfile?: (authorId: string) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  onOpenReportModal,
  onViewAuthorProfile,
}) => {
  const { currentUser, userProfile, isAdmin } = useAuth();

  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(post.likesCount || 0);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [replyToUsername, setReplyToUsername] = useState<string | null>(null);

  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const isAuthor = currentUser?.uid === post.authorId;

  // Listen to like state for current user
  useEffect(() => {
    if (!currentUser) return;
    const likeDocId = `${post.id}_${currentUser.uid}`;
    const likeRef = doc(db, 'likes', likeDocId);

    const unsub = onSnapshot(likeRef, (snap) => {
      setIsLiked(snap.exists());
    });
    return () => unsub();
  }, [post.id, currentUser]);

  // Keep likesCount in sync with post doc
  useEffect(() => {
    setLikesCount(post.likesCount || 0);
  }, [post.likesCount]);

  // Listen to comments for this post
  useEffect(() => {
    if (!showComments) return;
    const q = query(collection(db, 'comments'), where('postId', '==', post.id));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Comment));
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setComments(list);
    });
    return () => unsub();
  }, [showComments, post.id]);

  // Toggle Like / Unlike
  const toggleLike = async () => {
    if (!currentUser) return;
    const likeDocId = `${post.id}_${currentUser.uid}`;
    const likeRef = doc(db, 'likes', likeDocId);
    const postRef = doc(db, 'posts', post.id);

    try {
      if (isLiked) {
        setIsLiked(false);
        setLikesCount((prev) => Math.max(0, prev - 1));
        await deleteDoc(likeRef);
        await updateDoc(postRef, {
          likesCount: increment(-1),
        });
      } else {
        setIsLiked(true);
        setLikesCount((prev) => prev + 1);
        await setDoc(likeRef, {
          id: likeDocId,
          postId: post.id,
          userId: currentUser.uid,
          createdAt: new Date().toISOString(),
        });
        await updateDoc(postRef, {
          likesCount: increment(1),
        });

        // Create notification for author if not liking own post
        if (post.authorId !== currentUser.uid && userProfile) {
          await addDoc(collection(db, 'notifications'), {
            recipientId: post.authorId,
            senderId: currentUser.uid,
            senderName: userProfile.displayName,
            senderPhoto: userProfile.photoURL || '',
            type: 'like',
            title: 'Liked your post',
            content: `${userProfile.displayName} liked your post.`,
            link: post.id,
            read: false,
            createdAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error('Error toggling like:', err);
    }
  };

  // Submit comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !userProfile || !newCommentText.trim()) return;

    setSubmittingComment(true);
    try {
      await addDoc(collection(db, 'comments'), {
        postId: post.id,
        authorId: currentUser.uid,
        authorName: userProfile.displayName,
        authorUsername: userProfile.username,
        authorPhotoURL: userProfile.photoURL || '',
        content: newCommentText.trim(),
        parentCommentId: replyToCommentId || null,
        createdAt: new Date().toISOString(),
      });

      const postRef = doc(db, 'posts', post.id);
      await updateDoc(postRef, {
        commentsCount: increment(1),
      });

      // Notification
      if (post.authorId !== currentUser.uid) {
        await addDoc(collection(db, 'notifications'), {
          recipientId: post.authorId,
          senderId: currentUser.uid,
          senderName: userProfile.displayName,
          senderPhoto: userProfile.photoURL || '',
          type: 'comment',
          title: 'Commented on your post',
          content: `${userProfile.displayName}: "${newCommentText.slice(0, 60)}"`,
          link: post.id,
          read: false,
          createdAt: new Date().toISOString(),
        });
      }

      setNewCommentText('');
      setReplyToCommentId(null);
      setReplyToUsername(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'comments');
    } finally {
      setSubmittingComment(false);
    }
  };

  // Delete Post
  const handleDeletePost = async () => {
    if (!window.confirm('Are you sure you want to delete this post?')) return;
    try {
      await deleteDoc(doc(db, 'posts', post.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `posts/${post.id}`);
    }
  };

  // Save Edit Post
  const handleSaveEdit = async () => {
    if (!editContent.trim()) return;
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        content: editContent.trim(),
        isEdited: true,
        updatedAt: new Date().toISOString(),
      });
      setIsEditing(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `posts/${post.id}`);
    }
  };

  // Share / Copy Link
  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Post by ${post.authorName}`,
          text: post.content,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
      // Update share count
      await updateDoc(doc(db, 'posts', post.id), {
        sharesCount: increment(1),
      });
    } catch (e) {
      // Share cancelled
    }
  };

  // Format relative timestamp
  const formatTime = (isoString?: string) => {
    if (!isoString) return 'Just now';
    try {
      const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
      if (diff < 60) return 'Just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    } catch {
      return 'Recently';
    }
  };

  return (
    <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm mb-5 transition-colors">
      {/* Header with Author and Options */}
      <div className="flex items-center justify-between mb-3.5">
        <div
          onClick={() => onViewAuthorProfile?.(post.authorId)}
          className="flex items-center gap-3 cursor-pointer group"
        >
          <img
            src={post.authorPhotoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.authorId}`}
            alt={post.authorName}
            className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 group-hover:ring-2 group-hover:ring-indigo-500 transition-all"
          />
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              {post.authorName}
            </h4>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>@{post.authorUsername}</span>
              <span>•</span>
              <span>{formatTime(post.createdAt)}</span>
              {post.isEdited && <span className="italic">(edited)</span>}
            </div>
          </div>
        </div>

        {/* Options Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <MoreHorizontal size={18} />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-8 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl py-1.5 z-20 animate-in fade-in zoom-in-95 duration-100">
              {isAuthor && (
                <>
                  <button
                    onClick={() => { setIsEditing(true); setShowMenu(false); }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 flex items-center gap-2 cursor-pointer"
                  >
                    <Edit2 size={14} />
                    <span>Edit Post</span>
                  </button>
                  <button
                    onClick={() => { handleDeletePost(); setShowMenu(false); }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 size={14} />
                    <span>Delete Post</span>
                  </button>
                </>
              )}

              {!isAuthor && (
                <button
                  onClick={() => { onOpenReportModal(post.id); setShowMenu(false); }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2 cursor-pointer"
                >
                  <Flag size={14} />
                  <span>Report Post</span>
                </button>
              )}

              {isAdmin && !isAuthor && (
                <button
                  onClick={() => { handleDeletePost(); setShowMenu(false); }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-2 cursor-pointer border-t border-slate-100 dark:border-slate-700"
                >
                  <Trash2 size={14} />
                  <span>Admin Delete</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Post Text Content or Inline Edit */}
      {isEditing ? (
        <div className="mb-4">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={3}
            className="w-full p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              onClick={() => setIsEditing(false)}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
            >
              Save Changes
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm sm:text-base text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed mb-4">
          {post.content}
        </p>
      )}

      {/* Post Media: Image or Video */}
      {post.mediaUrl && post.mediaType !== 'none' && (
        <div className="mb-4 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-800 bg-black/5 dark:bg-black/40">
          {post.mediaType === 'image' ? (
            <img
              src={post.mediaUrl}
              alt="Post attachment"
              className="w-full max-h-[500px] object-cover sm:object-contain rounded-2xl mx-auto"
              loading="lazy"
            />
          ) : (
            <video
              src={post.mediaUrl}
              controls
              className="w-full max-h-[500px] object-contain rounded-2xl mx-auto"
            />
          )}
        </div>
      )}

      {/* Post Engagement Bar */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800/80 text-slate-500 dark:text-slate-400 text-xs sm:text-sm">
        {/* Like Button */}
        <button
          onClick={toggleLike}
          className={`flex items-center gap-1.5 py-1.5 px-3 rounded-xl transition-all cursor-pointer ${
            isLiked
              ? 'text-rose-600 dark:text-rose-500 bg-rose-50 dark:bg-rose-950/30'
              : 'hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Heart size={18} className={isLiked ? 'fill-rose-500 text-rose-500' : ''} />
          <span className="font-semibold">{likesCount}</span>
        </button>

        {/* Comment Button */}
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <MessageCircle size={18} />
          <span className="font-semibold">{post.commentsCount || 0}</span>
        </button>

        {/* Share Button */}
        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          {copiedLink ? <Check size={18} className="text-emerald-500" /> : <Share2 size={18} />}
          <span>{copiedLink ? 'Copied' : post.sharesCount || 'Share'}</span>
        </button>
      </div>

      {/* Comments Section */}
      {showComments && (
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3.5 animate-in fade-in duration-150">
          {/* New Comment Input */}
          <form onSubmit={handleAddComment} className="flex flex-col gap-2">
            {replyToUsername && (
              <div className="flex items-center justify-between text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-1 rounded-xl">
                <span>Replying to @{replyToUsername}</span>
                <button
                  type="button"
                  onClick={() => { setReplyToCommentId(null); setReplyToUsername(null); }}
                  className="font-bold text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={replyToUsername ? `Reply to @${replyToUsername}...` : 'Write a comment...'}
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                className="flex-1 px-4 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={submittingComment || !newCommentText.trim()}
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Send size={16} />
              </button>
            </div>
          </form>

          {/* Comments List */}
          {comments.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">No comments yet. Be the first to reply!</p>
          ) : (
            <div className="space-y-3 pt-2">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5 group">
                  <img
                    src={c.authorPhotoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.authorId}`}
                    alt={c.authorName}
                    className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                  />
                  <div className="flex-1 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {c.authorName}
                        </span>
                        <span className="text-[10px] text-slate-400">@{c.authorUsername}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">{formatTime(c.createdAt)}</span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300">{c.content}</p>
                    <button
                      onClick={() => {
                        setReplyToCommentId(c.id);
                        setReplyToUsername(c.authorUsername);
                      }}
                      className="mt-1.5 text-[10px] text-indigo-500 hover:text-indigo-400 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <CornerDownRight size={12} />
                      <span>Reply</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
};
