declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number; target: YTPlayer }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState?: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  setVolume: (volume: number) => void;
  getPlayerState: () => number;
  destroy: () => void;
}

let apiPromise: Promise<NonNullable<Window['YT']>> | null = null;

export function loadYouTubeIframeAPI(): Promise<NonNullable<Window['YT']>> {
  if (typeof window !== 'undefined' && window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const existingReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (existingReady) existingReady();
      if (window.YT) {
        resolve(window.YT);
      }
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }

    // Poll briefly in case API finished loading before callback attached
    const checkTimer = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(checkTimer);
        resolve(window.YT);
      }
    }, 50);
  });

  return apiPromise;
}
