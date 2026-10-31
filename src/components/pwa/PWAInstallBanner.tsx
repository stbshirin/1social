import React, { useState } from 'react';
import { Download, X, Share, CheckCircle2, Sparkles, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isDismissed, install, dismiss } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'installed' | 'cancelled'>('idle');

  // Do not show banner if already installed or dismissed by user in this session
  if (isInstalled || isDismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      setInstallStatus('installing');
      const result = await install();
      if (result === 'accepted') {
        setInstallStatus('installed');
        setTimeout(() => {
          dismiss();
        }, 2000);
      } else {
        setInstallStatus('cancelled');
        setTimeout(() => setInstallStatus('idle'), 3000);
      }
    } else if (isIOS) {
      setShowIOSModal(true);
    } else {
      // Browser fallback (e.g. desktop Chrome without prompt yet or Firefox)
      setShowIOSModal(true);
    }
  };

  return (
    <>
      {/* High-Converting Professional PWA Install Banner */}
      <div className="w-full max-w-2xl mx-auto mb-6 px-1 animate-in fade-in slide-in-from-top-3 duration-300">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 p-4 sm:p-5 shadow-2xl text-white backdrop-blur-xl">
          {/* Subtle Ambient Glow */}
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-violet-500/20 rounded-full blur-2xl pointer-events-none" />

          {/* Dismiss (X) Button */}
          <button
            onClick={dismiss}
            className="absolute top-3.5 right-3.5 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer z-10"
            title="Dismiss banner"
            aria-label="Close install banner"
          >
            <X size={16} />
          </button>

          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            {/* Left: Official 1 social Logo and Text */}
            <div className="flex items-center gap-3.5 pr-6 sm:pr-0">
              <div className="relative shrink-0">
                <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 text-white font-black text-2xl flex items-center justify-center shadow-lg shadow-indigo-600/40 border border-indigo-400/30">
                  1
                </div>
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center text-[9px] text-white font-bold">
                  ✓
                </span>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-black tracking-tight text-white leading-tight">
                    Install 1 social
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 hidden xs:inline">
                    App
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-indigo-200/80 mt-0.5 line-clamp-2 leading-snug">
                  Get faster access, 1-tap messaging, audio & video calls
                </p>
              </div>
            </div>

            {/* Right: Action Button */}
            <div className="w-full sm:w-auto flex items-center justify-end shrink-0 pt-1 sm:pt-0">
              <button
                onClick={handleInstallClick}
                disabled={installStatus === 'installing' || installStatus === 'installed'}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs sm:text-sm shadow-xl shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-75"
              >
                {installStatus === 'installed' ? (
                  <>
                    <CheckCircle2 size={16} className="text-emerald-300" />
                    <span>Installed!</span>
                  </>
                ) : installStatus === 'installing' ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Opening Dialog...</span>
                  </>
                ) : (
                  <>
                    <Download size={16} className="animate-bounce" />
                    <span>Install Now</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* iOS Safari / Manual Installation Guide Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl text-white relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white font-black text-base flex items-center justify-center shadow-md">
                  1
                </div>
                <h3 className="font-bold text-sm">Install 1 social</h3>
              </div>
              <button
                onClick={() => setShowIOSModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              To install 1 social on your iPhone, iPad, or mobile browser:
            </p>

            <div className="space-y-3 bg-slate-800/60 p-4 rounded-2xl text-xs text-slate-200 mb-5 border border-slate-700/50">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  Tap the <strong className="inline-flex items-center gap-1 text-indigo-400"><Share size={12} /> Share</strong> icon in your browser toolbar.
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  2
                </span>
                <span>
                  Scroll down the menu and tap <strong>"Add to Home Screen"</strong>.
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  3
                </span>
                <span>
                  Tap <strong>Add</strong> in the top-right corner to launch 1 social in standalone app mode.
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer shadow-md"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
