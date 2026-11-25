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
  const isNext = index === activeIndex + 1;
  const shouldMount = Math.abs(index - activeIndex) <= 1;
  const effectiveMuted = !audioUnlocked || isMuted;

  const playerMountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerReadyRef = useRef<boolean>(false);
  const prebufferedRef = useRef<boolean>(false);
  const lastTapRef = useRef<number>(0);
  const singleTapTimerRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const prebufferTimerRef = useRef<number | null>(null);
  const errorReportedRef = useRef<boolean>(false);

  const isActiveRef = useRef<boolean>(isActive);
  isActiveRef.current = isActive;
  const isNextRef = useRef<boolean>(isNext);
  isNextRef.current = isNext;
  const isPausedRef = useRef<boolean>(false);
  const effectiveMutedRef = useRef<boolean>(effectiveMuted);
  effectiveMutedRef.current = effectiveMuted;

  const [isPaused, setIsPaused] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [playerReadyTick, setPlayerReadyTick] = useState(0);
  const [thumbSrc, setThumbSrc] = useState(
    video.thumbnail || `https://i.ytimg.com/vi/${video.id}/oardefault.jpg`
  );
  const [thumbStep, setThumbStep] = useState(0);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  isPausedRef.current = isPaused;

  const scheduleReveal = (delayMs: number) => {
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
    }
    revealTimerRef.current = window.setTimeout(() => {
      if (isActiveRef.current && !isPausedRef.current) {
        setVideoPlaying(true);
      }
    }, delayMs);
  };

  // Mount player for active, previous (-1), and next (+1) reels so swiping transitions instantly
  // without waiting for a cold YouTube iframe boot or showing a black frame.
  useEffect(() => {
    if (!shouldMount) {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore
        }
        playerRef.current = null;
      }
      playerReadyRef.current = false;
      prebufferedRef.current = false;
      setIsPaused(false);
      isPausedRef.current = false;
      setVideoPlaying(false);
      return;
    }

    if (!playerMountRef.current) return;

    let cancelled = false;
    const container = playerMountRef.current;
    container.innerHTML = '';
    playerReadyRef.current = false;
    prebufferedRef.current = false;

    const initialMuteParam = audioUnlocked ? 0 : 1;
    const iframeEl = document.createElement('iframe');
    iframeEl.className =
      'absolute -top-[64px] left-1/2 -translate-x-1/2 h-[calc(100%+128px)] aspect-video max-w-none border-0 pointer-events-none';
    iframeEl.setAttribute(
      'allow',
      'autoplay; encrypted-media; gyroscope; picture-in-picture'
    );
    iframeEl.setAttribute('title', video.title);
    iframeEl.src = `https://www.youtube.com/embed/${video.id}?autoplay=${
      isActiveRef.current ? 1 : 0
    }&mute=${initialMuteParam}&playsinline=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&origin=${encodeURIComponent(
      window.location.origin
    )}`;
    container.appendChild(iframeEl);

    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !playerMountRef.current) return;

      const player = new YT.Player(iframeEl, {
        events: {
          onReady: ({ target }) => {
            if (cancelled) return;
            playerReadyRef.current = true;
            setPlayerReadyTick((t) => t + 1);

            if (isActiveRef.current && !isPausedRef.current) {
              if (!effectiveMutedRef.current) {
                target.unMute();
                target.setVolume(100);
              } else {
                target.mute();
              }
              target.playVideo();
            }
          },
          onStateChange: ({ data: state, target }) => {
            if (cancelled) return;

            // Pre-buffer complete for upcoming (+1) reel: immediately pause at 0:00 silently
            if (!isActiveRef.current) {
              if (state === 1) {
                prebufferedRef.current = true;
                try {
                  target.pauseVideo();
                  target.seekTo(0, true);
                } catch {
                  // Ignore
                }
              }
              return;
            }

            if (state === 1) {
              if (!effectiveMutedRef.current) {
                target.unMute();
                target.setVolume(100);
              } else {
                target.mute();
              }
              if (!isPausedRef.current) {
                // Only reveal iframe after real video frames start painting (zero black screen)
                scheduleReveal(prebufferedRef.current ? 90 : 200);
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
            if (!errorReportedRef.current && isActiveRef.current) {
              errorReportedRef.current = true;
              onEmbedError(video.id);
            }
          },
        },
      });

      playerRef.current = player;
    });

    return () => {
      cancelled = true;
      if (revealTimerRef.current) {
        window.clearTimeout(revealTimerRef.current);
      }
      if (prebufferTimerRef.current) {
        window.clearTimeout(prebufferTimerRef.current);
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore
        }
        playerRef.current = null;
      }
      playerReadyRef.current = false;
      prebufferedRef.current = false;
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [shouldMount, video.id, video.title, audioUnlocked, onEmbedError]);

  // Coordinate active playback, silent background pre-buffering (+1), and pause state
  useEffect(() => {
    if (prebufferTimerRef.current) {
      window.clearTimeout(prebufferTimerRef.current);
      prebufferTimerRef.current = null;
    }

    const player = playerRef.current;

    if (!isActive) {
      setIsPaused(false);
      isPausedRef.current = false;
      setVideoPlaying(false);
      if (revealTimerRef.current) {
        window.clearTimeout(revealTimerRef.current);
      }

      if (player && playerReadyRef.current) {
        try {
          player.setVolume(0);
          player.mute();
          player.pauseVideo();
        } catch {
          // Ignore
        }

        // Silently pre-buffer the very next reel after active reel gets head-start
        if (isNext && !prebufferedRef.current) {
          prebufferTimerRef.current = window.setTimeout(() => {
            if (!isActiveRef.current && isNextRef.current && playerRef.current && playerReadyRef.current) {
              try {
                playerRef.current.setVolume(0);
                playerRef.current.mute();
                window.setTimeout(() => {
                  if (!isActiveRef.current && isNextRef.current && playerRef.current) {
                    playerRef.current.playVideo();
                  }
                }, 60);
              } catch {
                // Ignore
              }
            }
          }, 320);
        }
      }
      return;
    }

    if (!player || !playerReadyRef.current) return;

    try {
      if (isPaused) {
        player.pauseVideo();
        setVideoPlaying(false);
      } else {
        if (!effectiveMuted) {
          player.unMute();
          player.setVolume(100);
        } else {
          player.mute();
        }
        player.playVideo();
        if (player.getPlayerState?.() === 1) {
          scheduleReveal(90);
        }
      }
    } catch {
      // Ignore transient YT API call error
    }
  }, [isActive, isNext, isPaused, effectiveMuted, playerReadyTick]);

  // Safety timeout: if an active video never reaches PLAYING within 7s, skip broken Short
  useEffect(() => {
    if (!isActive || videoPlaying || isPaused) return;
    const stallTimer = window.setTimeout(() => {
      if (isActiveRef.current && !isPausedRef.current && !errorReportedRef.current) {
        const state = playerRef.current?.getPlayerState?.();
        if (state === 1) {
          setVideoPlaying(true);
        } else if (state === -1 || state === undefined) {
          errorReportedRef.current = true;
          onEmbedError(video.id);
        }
      }
    }, 7000);
    return () => window.clearTimeout(stallTimer);
  }, [isActive, videoPlaying, isPaused, video.id, onEmbedError]);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
      if (prebufferTimerRef.current) window.clearTimeout(prebufferTimerRef.current);
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
            if (!effectiveMutedRef.current) {
              player.unMute();
              player.setVolume(100);
            } else {
              player.mute();
            }
            player.playVideo();
          }
        }
        return nextPaused;
      });
    }, 200);
  };

  const handleThumbError = () => {
    const fallbacks = [
      `https://i.ytimg.com/vi/${video.id}/oar2.jpg`,
      `https://i.ytimg.com/vi/${video.id}/oardefault.jpg`,
      `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
    ];
    const nextFallback = fallbacks.find((url, idx) => idx >= thumbStep && url !== thumbSrc);
    if (nextFallback) {
      setThumbStep((s) => s + 1);
      setThumbSrc(nextFallback);
    } else {
      setThumbFailed(true);
    }
  };

  const showIframe = isActive && videoPlaying && !isPaused;
  const showBufferingBar = isActive && !videoPlaying && !isPaused;

  return (
    <section
      aria-label={video.title}
      className="snap-start snap-always h-full w-full shrink-0 flex items-center justify-center sm:py-3 will-change-transform"
    >
      <div className="relative h-full w-full sm:w-auto sm:aspect-[9/16] sm:max-h-[880px] bg-zinc-900 sm:rounded-2xl overflow-hidden sm:border sm:border-white/[0.08] shadow-2xl">
        {/* Clean High-Res Thumbnail Backdrop stays visible until real decoded frames paint (zero black screen) */}
        {!thumbFailed ? (
          <img
            src={thumbSrc}
            alt={video.title}
            referrerPolicy="no-referrer"
            decoding="sync"
            loading={Math.abs(index - activeIndex) <= 6 ? 'eager' : 'lazy'}
            onError={handleThumbError}
            className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 to-zinc-950" />
        )}

        {/* Active / Pre-warmed YT.Player Container */}
        <div
          ref={playerMountRef}
          className={`absolute inset-0 pointer-events-none transition-opacity duration-150 ${
            showIframe ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Subtle 2px bottom progress shimmer while buffering next frame */}
        {showBufferingBar && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 inset-x-0 z-20 h-[2px] bg-white/10 overflow-hidden"
          >
            <div className="h-full w-1/2 bg-rose-500 animate-pulse rounded-full" />
          </div>
        )}

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
