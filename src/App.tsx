import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { LikedDrawer } from './components/LikedDrawer';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ReelCard } from './components/ReelCard';
import { TopNav } from './components/TopNav';
import type { ShortVideo, TopicOption } from './types';
import {
  buildTasteProfile,
  getTopTasteKeywords,
  rerankUpcomingQueue,
} from './utils/recommendations';

const STORAGE_KEY = 'shortflow_liked_shorts_v1';
const WATCHED_STORAGE_KEY = 'shortflow_watched_ids_v1';
const MAX_WATCHED_HISTORY = 2000;

function loadWatchedHistory(): string[] {
  try {
    const raw = localStorage.getItem(WATCHED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string').slice(-MAX_WATCHED_HISTORY)
      : [];
  } catch {
    return [];
  }
}

const DEFAULT_TOPICS: TopicOption[] = [
  { id: 'for-you', label: 'For You', query: 'for-you' },
  { id: 'comedy', label: 'Comedy', query: 'comedy' },
  { id: 'tech', label: 'Tech', query: 'tech' },
  { id: 'music', label: 'Music', query: 'music' },
  { id: 'fitness', label: 'Fitness', query: 'fitness' },
  { id: 'gaming', label: 'Gaming', query: 'gaming' },
  { id: 'facts', label: 'Facts', query: 'science facts' },
  { id: 'cooking', label: 'Cooking', query: 'cooking recipe' },
];

function loadSavedLikes(): ShortVideo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [topics, setTopics] = useState<TopicOption[]>(DEFAULT_TOPICS);
  const [activeTopic, setActiveTopic] = useState<TopicOption>(DEFAULT_TOPICS[0]);
  const [likedVideos, setLikedVideos] = useState<ShortVideo[]>(loadSavedLikes);
  const [isLikedOpen, setIsLikedOpen] = useState(false);

  const [queue, setQueue] = useState<ShortVideo[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const watchedOrderRef = useRef<string[]>(loadWatchedHistory());
  const watchedSetRef = useRef<Set<string>>(new Set(watchedOrderRef.current));
  const fetchingRef = useRef(false);
  const activeTopicRef = useRef(activeTopic);
  activeTopicRef.current = activeTopic;
  const topicCacheRef = useRef<Map<string, ShortVideo[]>>(new Map());

  const markAsWatched = useCallback((videoId: string) => {
    if (!videoId || watchedSetRef.current.has(videoId)) return;
    watchedSetRef.current.add(videoId);
    watchedOrderRef.current.push(videoId);
    if (watchedOrderRef.current.length > MAX_WATCHED_HISTORY) {
      watchedOrderRef.current = watchedOrderRef.current.slice(-MAX_WATCHED_HISTORY);
      watchedSetRef.current = new Set(watchedOrderRef.current);
    }
    try {
      localStorage.setItem(WATCHED_STORAGE_KEY, JSON.stringify(watchedOrderRef.current));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const tasteProfile = useMemo(() => buildTasteProfile(likedVideos), [likedVideos]);
  const topTasteKeywords = useMemo(
    () => getTopTasteKeywords(tasteProfile, 4),
    [tasteProfile]
  );

  const likedIdSet = useMemo(
    () => new Set(likedVideos.map((v) => v.id)),
    [likedVideos]
  );

  // Persist liked videos to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(likedVideos));
    } catch {
      // Ignore storage quota errors
    }
  }, [likedVideos]);

  const fetchBatch = useCallback(
    async (topicQuery: string, pageNum: number, customTasteKeywords?: string[]) => {
      const excludeSet = new Set<string>([
        ...watchedOrderRef.current.slice(-1600),
        ...Array.from(seenIdsRef.current).slice(-250),
      ]);

      const keywordsToUse =
        topicQuery === 'for-you' ? customTasteKeywords ?? topTasteKeywords : [];

      const res = await fetch('/api/shorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicQuery,
          page: pageNum,
          likedTopics: keywordsToUse,
          exclude: Array.from(excludeSet),
        }),
      });
      if (!res.ok) {
        throw new Error('Failed to load Shorts');
      }
      const data = await res.json();
      const rawItems = (data.items || []) as ShortVideo[];
      return rawItems.filter((v) => !watchedSetRef.current.has(v.id));
    },
    [topTasteKeywords]
  );

  const loadInitialTopic = useCallback(
    async (topic: TopicOption) => {
      setErrorMsg(null);
      pageRef.current = 0;
      seenIdsRef.current = new Set();
      setActiveIndex(0);

      if (feedRef.current) {
        feedRef.current.scrollTo({ top: 0, behavior: 'auto' });
      }

      // Filter any cached items against persisted watched history so watched reels never repeat
      const cachedRaw = topicCacheRef.current.get(topic.id);
      const cachedUnwatched = cachedRaw
        ? cachedRaw.filter((v) => !watchedSetRef.current.has(v.id))
        : [];
      if (cachedUnwatched.length >= 6) {
        topicCacheRef.current.set(topic.id, cachedUnwatched);
        cachedUnwatched.forEach((v) => seenIdsRef.current.add(v.id));
        setQueue(cachedUnwatched);
        setIsLoading(false);
        return;
      }
      topicCacheRef.current.delete(topic.id);

      setIsLoading(true);
      try {
        let items = await fetchBatch(topic.query, 0);
        if (activeTopicRef.current.id !== topic.id) return;

        if (items.length < 4) {
          const deeper = await fetchBatch(topic.query, 1);
          if (activeTopicRef.current.id !== topic.id) return;
          const existingIds = new Set(items.map((v) => v.id));
          items = [...items, ...deeper.filter((v) => !existingIds.has(v.id))];
          pageRef.current = 1;
        }

        items.forEach((v) => seenIdsRef.current.add(v.id));
        if (items.length > 0) {
          topicCacheRef.current.set(topic.id, items);
        }
        setQueue(items);
        if (items.length === 0) {
          setErrorMsg('Is topic ki saari reels aap dekh chuke hain ya koi nayi Shorts nahi mili.');
        }
      } catch {
        if (activeTopicRef.current.id !== topic.id) return;
        setErrorMsg('Could not load Shorts right now. Tap Retry.');
      } finally {
        if (activeTopicRef.current.id === topic.id) {
          setIsLoading(false);
        }
      }
    },
    [fetchBatch]
  );

  useEffect(() => {
    loadInitialTopic(activeTopic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTopic.id]);

  // Mark currently viewed reel as watched after brief viewing so it never repeats in future feeds
  useEffect(() => {
    const currentVideo = queue[activeIndex];
    if (!currentVideo) return;
    const timer = window.setTimeout(() => {
      markAsWatched(currentVideo.id);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeIndex, queue, markAsWatched]);

  // Silently warm-cache default top nav categories in browser RAM excluding already-watched IDs
  useEffect(() => {
    const timer = window.setTimeout(() => {
      DEFAULT_TOPICS.slice(1, 5).forEach(async (t) => {
        if (topicCacheRef.current.has(t.id)) return;
        try {
          const res = await fetch('/api/shorts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic: t.query,
              page: 0,
              exclude: watchedOrderRef.current.slice(-1500),
            }),
          });
          if (!res.ok) return;
          const data = await res.json();
          if (Array.isArray(data.items) && data.items.length > 0) {
            const unwatched = (data.items as ShortVideo[]).filter(
              (v) => !watchedSetRef.current.has(v.id)
            );
            if (unwatched.length > 0) {
              topicCacheRef.current.set(t.id, unwatched);
            }
          }
        } catch {
          // Ignore background prefetch errors
        }
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);

  const loadMore = useCallback(async () => {
    if (fetchingRef.current || isLoading) return;
    fetchingRef.current = true;
    setIsFetchingMore(true);

    try {
      const nextPage = pageRef.current + 1;
      const currentTopicId = activeTopicRef.current.id;
      const items = await fetchBatch(activeTopicRef.current.query, nextPage);

      if (activeTopicRef.current.id !== currentTopicId) return;

      pageRef.current = nextPage;
      if (items.length > 0) {
        setQueue((prev) => {
          const existing = new Set(prev.map((v) => v.id));
          const fresh = items.filter(
            (v) => !existing.has(v.id) && !watchedSetRef.current.has(v.id)
          );
          fresh.forEach((v) => seenIdsRef.current.add(v.id));
          return [...prev, ...fresh];
        });
      }
    } catch {
      // Silent retry on next scroll
    } finally {
      fetchingRef.current = false;
      setIsFetchingMore(false);
    }
  }, [fetchBatch, isLoading]);

  // Prefetch next batch very early (12 reels ahead) so scrolling never runs dry
  useEffect(() => {
    if (queue.length > 0 && activeIndex >= queue.length - 12) {
      loadMore();
    }
  }, [activeIndex, queue.length, loadMore]);

  // Preload thumbnails for upcoming 8 reels into browser image cache
  useEffect(() => {
    const upcoming = queue.slice(activeIndex + 1, activeIndex + 9);
    upcoming.forEach((v) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = v.thumbnail || `https://i.ytimg.com/vi/${v.id}/oardefault.jpg`;
    });
  }, [activeIndex, queue]);

  // Track active reel accurately via scroll position
  const handleFeedScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    const height = el.clientHeight;
    if (height <= 0) return;
    const idx = Math.round(el.scrollTop / height);
    if (idx !== activeIndex && idx >= 0 && idx < queue.length) {
      setActiveIndex(idx);
    }
  }, [activeIndex, queue.length]);

  const scrollToIndex = useCallback(
    (targetIdx: number) => {
      const el = feedRef.current;
      if (!el || queue.length === 0) return;
      const clamped = Math.max(0, Math.min(targetIdx, queue.length - 1));
      el.scrollTo({
        top: clamped * el.clientHeight,
        behavior: 'auto',
      });
      setActiveIndex(clamped);
    },
    [queue.length]
  );

  // Keyboard navigation: Up/Down/J/K to scroll, M to mute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLikedOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        scrollToIndex(activeIndex + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        scrollToIndex(activeIndex - 1);
      } else if (e.key === 'm') {
        e.preventDefault();
        setIsMuted((m) => !m);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, isLikedOpen, scrollToIndex]);

  const handleSelectTopic = useCallback((topic: TopicOption) => {
    setAudioUnlocked(true);
    setIsMuted(false);
    setActiveTopic(topic);
  }, []);

  // Like / Unlike handler + instant adaptive feed re-ranking & background fetch
  const handleToggleLike = useCallback(
    async (video: ShortVideo) => {
      markAsWatched(video.id);
      const alreadyLiked = likedIdSet.has(video.id);

      let nextLiked: ShortVideo[];
      if (alreadyLiked) {
        nextLiked = likedVideos.filter((v) => v.id !== video.id);
      } else {
        nextLiked = [video, ...likedVideos];
      }

      setLikedVideos(nextLiked);
      topicCacheRef.current.delete('for-you');

      const updatedProfile = buildTasteProfile(nextLiked);
      const updatedKeywords = getTopTasteKeywords(updatedProfile, 4);

      setQueue((prev) => rerankUpcomingQueue(prev, activeIndex, updatedProfile));

      if (!alreadyLiked && updatedKeywords.length > 0) {
        try {
          const seedTopics =
            video.keywords.length > 0
              ? video.keywords.slice(0, 2)
              : updatedKeywords.slice(0, 2);
          const freshItems = await fetchBatch(
            activeTopicRef.current.id === 'for-you'
              ? 'for-you'
              : activeTopicRef.current.query,
            pageRef.current + 1,
            seedTopics
          );

          if (freshItems.length > 0) {
            setQueue((prev) => {
              const existing = new Set(prev.map((v) => v.id));
              const uniqueFresh = freshItems
                .filter((v) => !existing.has(v.id) && !watchedSetRef.current.has(v.id))
                .slice(0, 6);
              if (uniqueFresh.length === 0) return prev;
              uniqueFresh.forEach((v) => seenIdsRef.current.add(v.id));

              const insertAt = Math.min(activeIndex + 3, prev.length);
              return [
                ...prev.slice(0, insertAt),
                ...uniqueFresh,
                ...prev.slice(insertAt),
              ];
            });
          }
        } catch {
          // Non-blocking adaptive fetch
        }
      }
    },
    [activeIndex, fetchBatch, likedIdSet, likedVideos, markAsWatched]
  );

  const handleRemoveLike = useCallback((videoId: string) => {
    topicCacheRef.current.delete('for-you');
    setLikedVideos((prev) => prev.filter((v) => v.id !== videoId));
  }, []);

  const handleClearAllLikes = useCallback(() => {
    topicCacheRef.current.delete('for-you');
    setLikedVideos([]);
  }, []);

  const handleAddCustomTopic = useCallback(
    (query: string) => {
      setAudioUnlocked(true);
      setIsMuted(false);
      const normalizedId = `custom-${encodeURIComponent(query.toLowerCase())}`;
      const existing = topics.find(
        (t) => t.id === normalizedId || t.label.toLowerCase() === query.toLowerCase()
      );
      if (existing) {
        topicCacheRef.current.delete(existing.id);
        if (existing.id === activeTopicRef.current.id) {
          void loadInitialTopic(existing);
        } else {
          setActiveTopic(existing);
        }
        return;
      }

      const newTopic: TopicOption = {
        id: normalizedId,
        label: query,
        query,
        isCustom: true,
      };
      setTopics((prev) => [prev[0], newTopic, ...prev.slice(1)]);
      setActiveTopic(newTopic);
    },
    [topics, loadInitialTopic]
  );

  const handlePlayFromLiked = useCallback(
    (video: ShortVideo) => {
      setAudioUnlocked(true);
      setIsMuted(false);
      const existingIdx = queue.findIndex((v) => v.id === video.id);
      if (existingIdx !== -1) {
        scrollToIndex(existingIdx);
        return;
      }

      const insertAt = Math.min(activeIndex + 1, queue.length);
      setQueue((prev) => [
        ...prev.slice(0, insertAt),
        video,
        ...prev.slice(insertAt),
      ]);
      window.setTimeout(() => {
        scrollToIndex(insertAt);
      }, 20);
    },
    [activeIndex, queue, scrollToIndex]
  );

  const handleResetWatchHistory = useCallback(() => {
    watchedOrderRef.current = [];
    watchedSetRef.current = new Set();
    topicCacheRef.current.clear();
    try {
      localStorage.removeItem(WATCHED_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    void loadInitialTopic(activeTopicRef.current);
  }, [loadInitialTopic]);

  const handleEmbedError = useCallback(
    (badVideoId: string) => {
      markAsWatched(badVideoId);
      setQueue((prev) => prev.filter((v) => v.id !== badVideoId));
    },
    [markAsWatched]
  );

  return (
    <div className="h-[100dvh] w-full bg-[#09090B] text-zinc-100 flex flex-col overflow-hidden">
      <TopNav
        topics={topics}
        activeTopicId={activeTopic.id}
        onSelectTopic={handleSelectTopic}
        onAddCustomTopic={handleAddCustomTopic}
        likedCount={likedVideos.length}
        onOpenLiked={() => setIsLikedOpen(true)}
      />

      <main className="relative flex-1 min-h-0 w-full flex items-center justify-center">
        {isLoading ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-7 h-7 text-rose-500 animate-spin" />
            <p className="text-sm text-zinc-400">Loading {activeTopic.label} Shorts...</p>
          </div>
        ) : errorMsg && queue.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-zinc-300 max-w-sm">{errorMsg}</p>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => loadInitialTopic(activeTopic)}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                Retry
              </button>
              {watchedOrderRef.current.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetWatchHistory}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors cursor-pointer"
                >
                  Reset Watched
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            ref={feedRef}
            onScroll={handleFeedScroll}
            className="h-full w-full overflow-y-scroll snap-y snap-mandatory overscroll-y-contain no-scrollbar"
          >
            {queue.map((video, index) => (
              <ReelCard
                key={video.id}
                video={video}
                index={index}
                activeIndex={activeIndex}
                isLiked={likedIdSet.has(video.id)}
                isMuted={isMuted}
                audioUnlocked={audioUnlocked}
                onToggleLike={handleToggleLike}
                onUnlockAudio={() => {
                  setAudioUnlocked(true);
                  setIsMuted(false);
                }}
                onToggleMute={() => {
                  setAudioUnlocked(true);
                  setIsMuted((m) => !m);
                }}
                onEmbedError={handleEmbedError}
              />
            ))}

            {isFetchingMore && (
              <div className="snap-start h-24 w-full flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
              </div>
            )}
          </div>
        )}
      </main>

      <OfflineIndicator />

      <LikedDrawer
        isOpen={isLikedOpen}
        likedVideos={likedVideos}
        topTasteKeywords={topTasteKeywords}
        onClose={() => setIsLikedOpen(false)}
        onRemoveLike={handleRemoveLike}
        onClearAll={handleClearAllLikes}
        onPlayVideo={handlePlayFromLiked}
      />
    </div>
  );
}
