import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-16 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-2xl bg-amber-600/95 text-white px-3.5 py-2 text-xs font-semibold shadow-xl backdrop-blur-md border border-amber-500/40 animate-in slide-in-from-bottom-2 duration-200">
      <WifiOff size={15} className="shrink-0 animate-pulse" />
      <span>Offline Mode — Cached application shell active</span>
    </div>
  );
};
