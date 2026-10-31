import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export const PWAUpdatePrompt: React.FC = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('1 social Service Worker registered:', r?.scope);
    },
    onRegisterError(error) {
      console.warn('1 social SW registration notice:', error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed top-20 right-4 z-50 max-w-sm rounded-2xl bg-indigo-900/95 text-white p-3.5 shadow-2xl border border-indigo-700/80 backdrop-blur-md animate-in slide-in-from-top duration-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-white mb-0.5">New update available</h4>
          <p className="text-[11px] text-indigo-200 leading-snug">
            A new version of 1 social is ready. Click update to refresh.
          </p>
        </div>
        <button
          onClick={() => setNeedRefresh(false)}
          className="text-indigo-300 hover:text-white p-0.5 cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          onClick={() => updateServiceWorker(true)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white text-indigo-950 font-bold text-xs shadow-sm hover:bg-indigo-50 transition-colors cursor-pointer"
        >
          <RefreshCw size={12} />
          <span>Update Now</span>
        </button>
      </div>
    </div>
  );
};
