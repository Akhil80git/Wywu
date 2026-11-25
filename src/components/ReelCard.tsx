import React, { useEffect, useRef, useState } from 'react';
import { Heart, Volume2, VolumeX } from 'lucide-react';
import type { ShortVideo } from '../types';
import { loadYouTubeIframeAPI, type YTPlayer } from '../utils/youtubeApi';

interface ReelCardProps {
  video: ShortVideo;
  index: number;
  activeIndex: number;
  isLiked: boolean;
  isMuted: boolean;
  audioUnlocked: boolean;
  onToggleLike: (video: ShortVideo) => void;
  onUnlockAudio: () => void;
  onToggleMute: () => void;
  onEmbedError: (videoId: string) => void;
}

export function ReelCard({
  video,
  index,
  activeIndex,
  isLiked,
  isMuted,
  audioUnlocked,
  onToggleLike,
  onUnlockAudio,
  onToggleMute,
  onEmbedError,
}: ReelCardProps) {
  const isActive = index === activeIndex;
  const effectiveMuted = !audioUnlocked || isMuted;

  const playerMountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerReadyRef = useRef<boolean>(false);
  const lastTapRef = useRef<number>(0);
  const singleTapTimerRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const errorReportedRef = useRef<boolean>(false);

  const isActiveRef = useRef<boolean>(isActive);
  isActiveRef.current = isActive;
  const isPausedRef = useRef<boolean>(false);

  const [isPaused, setIsPaused] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [thumbSrc, setThumbSrc] = useState(
    video.thumbnail || `https://i.ytimg.com/vi/${video.id}/oardefault.jpg`
  );
  const [thumbFailed, setThumbFailed] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  isPausedRef.current = isPaused;

  // Mount ONLY the active reel's player with native mute=0 once audio is unlocked
  // This gives 100% bandwidth to the active reel and guarantees sound works natively
  useEffect(() => {
    if (!isActive) {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore
        }
        playerRef.current = null;
        playerReadyRef.current = false;
      }
      setIsPaused(false);
      isPausedRef.current = false;
      setVideoPlaying(false);
      return;
    }

    if (!playerMountRef.current) return;

    let cancelled = false;
    const container = playerMountRef.current;
    container.innerHTML = '';

    // Create iframe with explicit allow="autoplay" BEFORE setting src so browser grants audio permission immediately
    const iframeEl = document.createElement('iframe');
    iframeEl.className =
      'absolute -top-[64px] left-1/2 -translate-x-1/2 h-[calc(100%+128px)] aspect-video max-w-none border-0 pointer-events-none';
    iframeEl.setAttribute(
      'allow',
      'autoplay; encrypted-media; gyroscope; picture-in-picture'
    );
    iframeEl.setAttribute('title', video.title);
    iframeEl.src = `https://www.youtube.com/embed/${video.id}?autoplay=1&mute=${
      effectiveMuted ? 1 : 0
    }&playsinline=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&origin=${encodeURIComponent(
      window.location.origin
    )}`;
    container.appendChild(iframeEl);

    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !playerMountRef.current || !isActiveRef.current) return;

      const player = new YT.Player(iframeEl, {
        events: {
          onReady: ({ target }) => {
            if (cancelled || !isActiveRef.current) return;
            playerReadyRef.current = true;
            if (!effectiveMuted) {
              target.unMute();
              target.setVolume(100);
            }
            target.playVideo();
          },
          onStateChange: ({ data: state, target }) => {
            if (cancelled || !isActiveRef.current) return;

            if (state === 1) {
              if (!effectiveMuted) {
                target.unMute();
                target.setVolume(100);
              }
              if (!isPausedRef.current) {
                if (revealTimerRef.current) {
                  window.clearTimeout(revealTimerRef.current);
                }
                revealTimerRef.current = window.setTimeout(() => {
                  if (isActiveRef.current && !isPausedRef.current) {
                    setVideoPlaying(true);
                  }
                }, 150);
              }
            } else if (state === 0) {
              if (!isPausedRef.current) {
                target.seekTo(0, true);
                target.playVideo();
              }
            } else if (state === 2) {
              if (isPausedRef.current) {
                setVideoPlaying(false);
              }
            }
          },
          onError: () => {
            if (!errorReportedRef.current) {
              errorReportedRef.current = true;
              onEmbedError(video.id);
            }
          },
        },
      });

      playerRef.current = player;
    });

    // Fallback reveal in case iframe plays natively even if YT API callback lags
    const nativeReveal = window.setTimeout(() => {
      if (!cancelled && isActiveRef.current && !isPausedRef.current) {
        setVideoPlaying(true);
      }
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(nativeReveal);
      if (revealTimerRef.current) {
        window.clearTimeout(revealTimerRef.current);
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore
        }
        playerRef.current = null;
        playerReadyRef.current = false;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [isActive, video.id, video.title, effectiveMuted, onEmbedError]);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    };
  }, []);

  const handleStageTap = () => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;

    if (!audioUnlocked) {
      onUnlockAudio();
      return;
    }

    if (timeSinceLastTap < 240) {
      if (singleTapTimerRef.current) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      if (!isLiked) {
        onToggleLike(video);
      }
      setBurstKey((k) => k + 1);
      return;
    }

    if (singleTapTimerRef.current) {
      window.clearTimeout(singleTapTimerRef.current);
    }

    singleTapTimerRef.current = window.setTimeout(() => {
      const player = playerRef.current;
      setIsPaused((prevPaused) => {
        const nextPaused = !prevPaused;
        isPausedRef.current = nextPaused;
        if (player && playerReadyRef.current) {
          if (nextPaused) {
            setVideoPlaying(false);
            player.pauseVideo();
          } else {
            if (!effectiveMuted) {
              player.unMute();
              player.setVolume(100);
            }
            player.playVideo();
          }
        }
        return nextPaused;
      });
    }, 200);
  };

  const showIframe = isActive && videoPlaying && !isPaused;

  return (
    <section
      aria-label={video.title}
      className="snap-start snap-always h-full w-full shrink-0 flex items-center justify-center sm:py-3 will-change-transform"
    >
      <div className="relative h-full w-full sm:w-auto sm:aspect-[9/16] sm:max-h-[880px] bg-zinc-950 sm:rounded-2xl overflow-hidden sm:border sm:border-white/[0.08] shadow-2xl">
        {/* Clean Thumbnail Backdrop */}
        {!thumbFailed ? (
          <img
            src={thumbSrc}
            alt={video.title}
            referrerPolicy="no-referrer"
            loading={Math.abs(index - activeIndex) <= 5 ? 'eager' : 'lazy'}
            onError={() => {
              if (!thumbSrc.includes('hqdefault.jpg')) {
                setThumbSrc(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`);
              } else {
                setThumbFailed(true);
              }
            }}
            className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none"
          />
        ) : (
          <div className="absolute inset-0 bg-zinc-950" />
        )}

        {/* Active YT.Player Container */}
        <div
          ref={playerMountRef}
          className={`absolute inset-0 pointer-events-none transition-opacity duration-100 ${
            showIframe ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Gesture Overlay */}
        <div
          role="button"
          tabIndex={isActive ? 0 : -1}
          aria-label={isPaused ? 'Resume reel' : 'Pause reel or double tap to like'}
          onClick={handleStageTap}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              handleStageTap();
            }
          }}
          className="absolute inset-0 z-10 cursor-pointer focus:outline-none"
        />

        {/* One-time Tap-to-Start-Sound prompt before browser receives first click */}
        {isActive && !audioUnlocked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnlockAudio();
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 min-h-[44px] px-4 py-2 rounded-full bg-black/70 hover:bg-black/85 backdrop-blur-md border border-white/15 flex items-center gap-2 text-xs font-medium text-white shadow-xl cursor-pointer transition-transform active:scale-95"
          >
            <Volume2 className="w-4 h-4 text-rose-400" />
            <span>Tap for Sound</span>
          </button>
        )}

        {/* Double-Tap Heart Burst */}
        {burstKey > 0 && (
          <div
            key={burstKey}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          >
            <Heart className="w-16 h-16 fill-rose-500 text-rose-500 drop-shadow-xl animate-heart-burst" />
          </div>
        )}

        {/* Small Top-Left Sound On/Off Icon */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!audioUnlocked) {
              onUnlockAudio();
            } else {
              onToggleMute();
            }
          }}
          aria-pressed={!effectiveMuted}
          aria-label={effectiveMuted ? 'Turn sound on' : 'Turn sound off'}
          className="absolute top-3.5 left-3.5 z-20 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full bg-black/45 hover:bg-black/65 backdrop-blur-sm text-white/95 transition-transform duration-100 active:scale-90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          {effectiveMuted ? (
            <VolumeX className="w-4 h-4 drop-shadow" />
          ) : (
            <Volume2 className="w-4 h-4 drop-shadow" />
          )}
        </button>

        {/* ONLY a Small Like Icon */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!audioUnlocked) onUnlockAudio();
            onToggleLike(video);
          }}
          aria-pressed={isLiked}
          aria-label={isLiked ? 'Unlike this reel' : 'Like this reel'}
          className="absolute bottom-5 right-3.5 z-20 min-h-[44px] min-w-[44px] flex items-center justify-center transition-transform duration-100 active:scale-90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-full"
        >
          <Heart
            className={`w-6 h-6 drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)] transition-all duration-150 ${
              isLiked
                ? 'fill-rose-500 text-rose-500 scale-110'
                : 'text-white/90 hover:text-white'
            }`}
          />
        </button>
      </div>
    </section>
  );
}
