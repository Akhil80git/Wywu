import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Install ShortFlow app"
        title="Install ShortFlow App"
        className="min-h-[40px] px-2.5 sm:px-3 py-1.5 flex items-center gap-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs sm:text-sm font-medium text-zinc-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
      >
        <Download className="w-4 h-4 text-rose-400 shrink-0" />
        <span className="hidden md:inline">Install</span>
      </button>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install ShortFlow App"
          onClick={() => setShowGuide(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#111114] border border-white/[0.1] p-5 shadow-2xl text-zinc-100"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
                  <Smartphone className="w-4 h-4 text-rose-400" />
                </div>
                <h3 className="text-base font-semibold text-white">
                  Install ShortFlow App
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install guide"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-2.5 text-sm text-zinc-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-xs font-semibold text-white flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Safari toolbar mein <Share className="inline w-3.5 h-3.5 mx-0.5 text-rose-400" />{' '}
                    <strong className="text-white">Share</strong> button tap karein.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-xs font-semibold text-white flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Neeche scroll karke <strong className="text-white">Add to Home Screen</strong> select karein.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-2.5 text-sm text-zinc-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-xs font-semibold text-white flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Agar aap preview window mein hain, to app ko direct browser tab (Chrome / Edge / Android) mein open karein.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-xs font-semibold text-white flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Browser menu ya address bar mein <strong className="text-white">Install app</strong> / <strong className="text-white">Add to Home Screen</strong> par click karein.
                  </span>
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[42px] rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
