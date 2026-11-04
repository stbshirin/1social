import React, { useState, useRef } from 'react';
import { Send, Smile, Hash, Sparkles, X } from 'lucide-react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { handleFirestoreError, OperationType } from '../../firebase/errorHandler';

interface CreatePostCardProps {
  onPostCreated?: () => void;
  onSelectTag?: (tag: string) => void;
}

const POPULAR_EMOJIS = ['😀', '😂', '😍', '🔥', '👍', '🎉', '🚀', '👏', '❤️', '✨', '💯', '💡', '😎', '🌟', '🙌'];
const SUGGESTED_HASHTAGS = ['#1social', '#trending', '#thoughts', '#news', '#community', '#tech'];

export const CreatePostCard: React.FC<CreatePostCardProps> = ({ onPostCreated, onSelectTag }) => {
  const { currentUser, userProfile } = useAuth();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showHashtagPicker, setShowHashtagPicker] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertAtCursor = (textToInsert: string) => {
    if (!textareaRef.current) {
      setContent((prev) => prev + textToInsert);
      return;
    }

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const newText = content.substring(0, start) + textToInsert + content.substring(end);
    setContent(newText);

    // Reposition cursor after the inserted text
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const cursorPosition = start + textToInsert.length;
        textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
      }
    }, 0);
  };

  const handleAddEmoji = (emoji: string) => {
    insertAtCursor(emoji);
    setShowEmojiPicker(false);
  };

  const handleAddHashtag = (tag: string) => {
    // Add space before if needed
    const prefix = content.length > 0 && !content.endsWith(' ') && !content.endsWith('\n') ? ' ' : '';
    insertAtCursor(`${prefix}${tag} `);
    setShowHashtagPicker(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!currentUser || !userProfile || !trimmed) return;

    setLoading(true);
    setErrorNotice(null);

    try {
      await addDoc(collection(db, 'posts'), {
        authorId: currentUser.uid,
        authorName: userProfile.displayName,
        authorUsername: userProfile.username,
        authorPhotoURL: userProfile.photoURL || '',
        content: trimmed,
        mediaType: 'none',
        mediaUrl: '',
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        isEdited: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      setContent('');
      setShowEmojiPicker(false);
      setShowHashtagPicker(false);
      onPostCreated?.();
    } catch (err: any) {
      console.error('Error creating text post:', err);
      setErrorNotice(err.message || 'Failed to publish post. Please check your connection and retry.');
      handleFirestoreError(err, OperationType.CREATE, 'posts');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm mb-6 transition-colors">
      <div className="flex gap-3.5">
        <img
          src={userProfile?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=me`}
          alt="Avatar"
          className="w-11 h-11 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
        />

        <div className="flex-1">
          <form onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              rows={3}
              value={content}
              maxLength={2000}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`What's on your mind, ${userProfile?.displayName?.split(' ')[0] || ''}? Share your thoughts or #hashtags...`}
              className="w-full bg-transparent resize-none border-none outline-none text-sm sm:text-base text-slate-900 dark:text-white placeholder-slate-400 focus:ring-0 p-0"
            />

            {/* Quick Hashtags Suggestions Bar */}
            {showHashtagPicker && (
              <div className="mt-2.5 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Hash size={12} className="text-indigo-500" />
                    Insert Popular Hashtag
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowHashtagPicker(false)}
                    className="text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_HASHTAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleAddHashtag(tag)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/50 transition-colors cursor-pointer"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Emoji Picker Row */}
            {showEmojiPicker && (
              <div className="mt-2.5 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Smile size={12} className="text-amber-500" />
                    Insert Emoji
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(false)}
                    className="text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 text-lg">
                  {POPULAR_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleAddEmoji(emoji)}
                      className="p-1.5 rounded-xl hover:bg-white dark:hover:bg-slate-700 transition-transform active:scale-125 cursor-pointer"
                      title={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error Notice */}
            {errorNotice && (
              <p className="mt-2 text-xs text-rose-500 font-medium">{errorNotice}</p>
            )}

            {/* Bottom Toolbar & Text Post Button */}
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* Emoji Trigger */}
                <button
                  type="button"
                  onClick={() => {
                    setShowEmojiPicker(!showEmojiPicker);
                    setShowHashtagPicker(false);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    showEmojiPicker
                      ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Add Emoji"
                >
                  <Smile size={16} className="text-amber-500" />
                  <span>Emoji</span>
                </button>

                {/* Hashtag Trigger */}
                <button
                  type="button"
                  onClick={() => {
                    setShowHashtagPicker(!showHashtagPicker);
                    setShowEmojiPicker(false);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    showHashtagPicker
                      ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Add Hashtags"
                >
                  <Hash size={16} className="text-indigo-500" />
                  <span>Hashtags</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                {/* Character Count */}
                {content.length > 0 && (
                  <span className={`text-[11px] font-mono ${content.length > 1800 ? 'text-amber-500 font-bold' : 'text-slate-400'}`}>
                    {content.length}/2000
                  </span>
                )}

                {/* Submit Post Button */}
                <button
                  type="submit"
                  disabled={loading || !content.trim()}
                  className="flex items-center gap-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Post</span>
                      <Send size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
