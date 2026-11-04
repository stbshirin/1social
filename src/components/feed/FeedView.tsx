import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { Post } from '../../types';
import { CreatePostCard } from './CreatePostCard';
import { PostCard } from './PostCard';
import { PWAInstallBanner } from '../pwa/PWAInstallBanner';
import { Sparkles, TrendingUp, Hash } from 'lucide-react';

interface FeedViewProps {
  onOpenReportModal: (postId: string) => void;
  onViewAuthorProfile?: (authorId: string) => void;
  selectedTag?: string | null;
  onClearTag?: () => void;
  onSelectTag?: (tag: string) => void;
}

export const FeedView: React.FC<FeedViewProps> = ({
  onOpenReportModal,
  onViewAuthorProfile,
  selectedTag,
  onClearTag,
  onSelectTag,
}) => {
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<'latest' | 'trending'>('latest');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;

    // Load recent posts ordered by createdAt descending
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Post));
        setPosts(list);
        setLoading(false);
      },
      (error) => {
        console.warn('Posts listener error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // Compute trending hashtags from the loaded posts
  const trendingTagsFromPosts = useMemo(() => {
    const counts: Record<string, number> = {};
    posts.forEach((p) => {
      const tags = p.content?.match(/#[a-zA-Z0-9_\u0980-\u09FF]+/g);
      if (tags) {
        tags.forEach((tag) => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      }
    });

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));

    if (sorted.length > 0) {
      return sorted.slice(0, 6);
    }

    return [
      { tag: '#1social', count: 1 },
      { tag: '#trending', count: 1 },
      { tag: '#thoughts', count: 1 },
      { tag: '#community', count: 1 },
    ];
  }, [posts]);

  // Filter posts based on selected hashtag or tab
  const displayedPosts = posts
    .filter((p) => {
      if (selectedTag) {
        return p.content?.toLowerCase().includes(selectedTag.toLowerCase());
      }
      return true;
    })
    .sort((a, b) => {
      if (filter === 'trending') {
        const scoreA = (a.likesCount || 0) * 2 + (a.commentsCount || 0) * 3 + (a.sharesCount || 0) * 4;
        const scoreB = (b.likesCount || 0) * 2 + (b.commentsCount || 0) * 3 + (b.sharesCount || 0) * 4;
        return scoreB - scoreA;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="w-full max-w-2xl mx-auto py-6 px-3 sm:px-4">
      {/* Tag filter banner if active */}
      {selectedTag && (
        <div className="mb-4 flex items-center justify-between p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300">
          <span className="text-sm font-semibold">Filtering by {selectedTag}</span>
          <button
            onClick={onClearTag}
            className="text-xs font-bold underline hover:text-indigo-900 dark:hover:text-white cursor-pointer"
          >
            Clear Filter
          </button>
        </div>
      )}

      {/* PWA Install Banner */}
      <PWAInstallBanner />

      {/* Text-Only Post Composer */}
      <CreatePostCard onSelectTag={onSelectTag} />

      {/* Trending Hashtags Quick Filter Bar */}
      {trendingTagsFromPosts.length > 0 && (
        <div className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <div className="flex items-center gap-1 text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0 mr-1">
            <Hash size={13} className="text-indigo-500" />
            <span>Trending:</span>
          </div>
          {trendingTagsFromPosts.map(({ tag, count }) => {
            const isSelected = selectedTag?.toLowerCase() === tag.toLowerCase();
            return (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  if (isSelected) {
                    onClearTag?.();
                  } else {
                    onSelectTag?.(tag);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-400'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-400'
                }`}
              >
                <span>{tag}</span>
                {count > 1 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isSelected
                        ? 'bg-indigo-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Feed Filter Bar */}
      <div className="flex items-center gap-2 mb-6 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setFilter('latest')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all cursor-pointer ${
            filter === 'latest'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Sparkles size={16} />
          <span>Latest</span>
        </button>

        <button
          onClick={() => setFilter('trending')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all cursor-pointer ${
            filter === 'trending'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <TrendingUp size={16} />
          <span>Trending</span>
        </button>
      </div>

      {/* Posts Stream */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm animate-pulse"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800" />
                <div className="space-y-2 flex-1">
                  <div className="w-32 h-4 bg-slate-200 dark:bg-slate-800 rounded" />
                  <div className="w-20 h-3 bg-slate-100 dark:bg-slate-800/60 rounded" />
                </div>
              </div>
              <div className="w-full h-16 bg-slate-100 dark:bg-slate-800/40 rounded-xl mb-4" />
              <div className="w-3/4 h-3 bg-slate-100 dark:bg-slate-800/60 rounded" />
            </div>
          ))}
        </div>
      ) : displayedPosts.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-10 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-3">
            <Sparkles size={28} />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">No posts found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {selectedTag
              ? `No posts tagged with ${selectedTag} yet. Write the first one!`
              : 'Share your thoughts, emojis, or #hashtags on the 1 social network!'}
          </p>
        </div>
      ) : (
        <div>
          {displayedPosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onOpenReportModal={onOpenReportModal}
              onViewAuthorProfile={onViewAuthorProfile}
              onSelectTag={onSelectTag}
            />
          ))}
        </div>
      )}
    </div>
  );
};
