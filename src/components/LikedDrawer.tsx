import React, { useEffect } from 'react';
import { Heart, Play, Trash2, X } from 'lucide-react';
import type { ShortVideo } from '../types';

interface LikedDrawerProps {
  isOpen: boolean;
  likedVideos: ShortVideo[];
  topTasteKeywords: string[];
  onClose: () => void;
  onRemoveLike: (videoId: string) => void;
  onClearAll: () => void;
  onPlayVideo: (video: ShortVideo) => void;
}

export function LikedDrawer({
  isOpen,
  likedVideos,
  topTasteKeywords,
  onClose,
  onRemoveLike,
  onClearAll,
  onPlayVideo,
}: LikedDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Liked Shorts"
      className="fixed inset-0 z-50 flex justify-end"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
      />

      {/* Drawer Panel */}
      <aside className="relative z-10 w-full sm:max-w-md h-full bg-[#111114] border-l border-white/[0.08] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-white">Liked Shorts</h2>
              <span className="font-mono tabular-nums text-sm text-rose-400">
                {likedVideos.length}
              </span>
            </div>
            {topTasteKeywords.length > 0 && (
              <p className="mt-1 text-xs text-zinc-400 truncate">
                Feed tuned to: {topTasteKeywords.join(' · ')}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close liked drawer"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-3 divide-y divide-white/[0.06]">
          {likedVideos.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
              <div className="w-12 h-12 rounded-full bg-zinc-900 border border-white/[0.08] flex items-center justify-center mb-4">
                <Heart className="w-5 h-5 text-zinc-500" />
              </div>
              <p className="text-sm font-medium text-zinc-200">No liked Shorts yet</p>
              <p className="mt-1.5 text-xs text-zinc-400 max-w-xs leading-relaxed">
                Double-tap any reel or hit Like. Your feed will automatically start showing more of what you enjoy.
              </p>
            </div>
          ) : (
            likedVideos.map((video) => (
              <div
                key={video.id}
                className="py-3 flex items-center gap-3 group"
              >
                <button
                  type="button"
                  onClick={() => {
                    onPlayVideo(video);
                    onClose();
                  }}
                  className="relative w-12 h-20 rounded-lg overflow-hidden bg-zinc-900 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <img
                    src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/oardefault.jpg`}
                    alt={video.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="w-4 h-4 fill-white text-white" />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onPlayVideo(video);
                    onClose();
                  }}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <p className="text-sm font-medium text-zinc-100 line-clamp-2 leading-snug group-hover:text-white">
                    {video.title}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400 truncate">
                    {video.topic}
                    {video.views ? ` · ${video.views}` : ''}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onRemoveLike(video.id)}
                  aria-label={`Remove ${video.title} from liked`}
                  title="Remove from liked"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {likedVideos.length > 0 && (
          <div className="p-4 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClearAll}
              className="w-full min-h-[44px] rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              Remove all liked Shorts
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
