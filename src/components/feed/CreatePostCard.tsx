import React, { useState, useRef, useEffect } from 'react';
import { Image, Video, Sparkles, X, Send } from 'lucide-react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { handleFirestoreError, OperationType } from '../../firebase/errorHandler';
import { uploadPostMedia } from '../../services/storageService';

interface CreatePostCardProps {
  onPostCreated?: () => void;
}

export const CreatePostCard: React.FC<CreatePostCardProps> = ({ onPostCreated }) => {
  const { currentUser, userProfile } = useAuth();
  const [content, setContent] = useState('');
  const [mediaType, setMediaType] = useState<'none' | 'image' | 'video'>('none');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clean up object URL when component unmounts
  useEffect(() => {
    return () => {
      if (mediaPreview && mediaPreview.startsWith('blob:')) {
        URL.revokeObjectURL(mediaPreview);
      }
    };
  }, [mediaPreview]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isImage && !isVideo) {
      setUploadError('Please select a valid image or video file.');
      return;
    }

    if (isImage && file.size > 15 * 1024 * 1024) {
      setUploadError('Image size exceeds 15MB limit.');
      return;
    }

    if (isVideo && file.size > 50 * 1024 * 1024) {
      setUploadError('Video size exceeds 50MB limit.');
      return;
    }

    // Revoke previous blob url if exists
    if (mediaPreview && mediaPreview.startsWith('blob:')) {
      URL.revokeObjectURL(mediaPreview);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setMediaPreview(objectUrl);
    setMediaType(isVideo ? 'video' : 'image');
  };

  const clearMedia = () => {
    if (mediaPreview && mediaPreview.startsWith('blob:')) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaType('none');
    setMediaUrl('');
    setMediaPreview(null);
    setSelectedFile(null);
    setUploadProgress(null);
    setUploadError(null);
    setShowUrlInput(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !userProfile || (!content.trim() && !selectedFile && !mediaUrl)) return;

    setLoading(true);
    setUploadError(null);

    try {
      let finalMediaUrl = mediaUrl.trim();
      let finalMediaType = mediaType;

      // If a local file was selected, upload directly to Firebase Storage
      if (selectedFile) {
        setUploadProgress(1);
        const uploadResult = await uploadPostMedia(
          currentUser.uid,
          selectedFile,
          (percent) => setUploadProgress(percent)
        );
        finalMediaUrl = uploadResult.url;
        finalMediaType = uploadResult.type;
      }

      await addDoc(collection(db, 'posts'), {
        authorId: currentUser.uid,
        authorName: userProfile.displayName,
        authorUsername: userProfile.username,
        authorPhotoURL: userProfile.photoURL || '',
        content: content.trim(),
        mediaType: finalMediaType,
        mediaUrl: finalMediaUrl,
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        isEdited: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      setContent('');
      clearMedia();
      onPostCreated?.();
    } catch (err: any) {
      console.error('Error creating post:', err);
      setUploadError(err.message || 'Failed to publish post. Please check connection and retry.');
      handleFirestoreError(err, OperationType.CREATE, 'posts');
    } finally {
      setLoading(false);
      setUploadProgress(null);
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
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`What's on your mind, ${userProfile?.displayName?.split(' ')[0] || ''}?`}
              className="w-full bg-transparent resize-none border-none outline-none text-sm sm:text-base text-slate-900 dark:text-white placeholder-slate-400 focus:ring-0 p-0"
            />

            {/* Media Preview Box */}
            {mediaPreview && (
              <div className="relative mt-3 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950 max-h-72">
                <button
                  type="button"
                  onClick={clearMedia}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white z-10 cursor-pointer"
                  title="Remove media"
                >
                  <X size={16} />
                </button>
                {mediaType === 'image' ? (
                  <img
                    src={mediaPreview}
                    alt="Upload preview"
                    className="w-full h-auto max-h-72 object-contain mx-auto"
                  />
                ) : (
                  <video
                    src={mediaPreview}
                    controls
                    className="w-full h-auto max-h-72 object-contain mx-auto"
                  />
                )}
              </div>
            )}

            {/* Optional URL input for direct web media */}
            {showUrlInput && !mediaPreview && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="url"
                  placeholder="Paste direct image or video URL..."
                  value={mediaUrl}
                  onChange={(e) => {
                    setMediaUrl(e.target.value);
                    setMediaPreview(e.target.value);
                    setMediaType(e.target.value.match(/\.(mp4|webm|mov)$/i) ? 'video' : 'image');
                  }}
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowUrlInput(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Hidden native file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={handleFileUpload}
            />

            {/* Upload Progress Bar */}
            {uploadProgress !== null && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-indigo-500 font-medium mb-1">
                  <span>Uploading media to Firebase Storage...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error Message */}
            {uploadError && (
              <p className="mt-2 text-xs text-rose-500 font-medium">{uploadError}</p>
            )}

            {/* Bottom Toolbar & Post Button */}
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer"
                >
                  <Image size={17} />
                  <span>Photo / Video</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors cursor-pointer"
                >
                  <Sparkles size={17} />
                  <span>Media URL</span>
                </button>
              </div>

              <button
                type="submit"
                disabled={loading || (!content.trim() && !mediaUrl && !selectedFile)}
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
          </form>
        </div>
      </div>
    </div>
  );
};
