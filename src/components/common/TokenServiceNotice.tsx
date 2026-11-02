import React, { useState } from 'react';
import { ExternalLink, X, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface TokenServiceNoticeProps {
  projectId?: string;
  projectNumber?: string;
}

export const TokenServiceNotice: React.FC<TokenServiceNoticeProps> = ({
  projectId = 'autonomous-technique-mnm8c',
  projectNumber = '123885793660',
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  if (dismissed) return null;

  const enableUrl = `https://console.developers.google.com/apis/api/securetoken.googleapis.com/overview?project=${projectNumber}`;

  const handleRetry = () => {
    setRetrying(true);
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  return (
    <div className="w-full bg-gradient-to-r from-amber-950 via-slate-900 to-amber-950 border-b border-amber-500/40 px-4 py-3 text-white text-xs sm:text-sm animate-in fade-in duration-200 shadow-lg">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 mt-0.5 sm:mt-0">
            <ShieldAlert size={18} />
          </div>
          <div>
            <p className="font-semibold text-amber-200">
              Action Required: Enable Token Service API on Google Cloud
            </p>
            <p className="text-slate-300 text-xs mt-0.5">
              Project <span className="font-mono text-amber-300 font-semibold">{projectNumber}</span> ({projectId}) requires the Token Service API to exchange Firebase credentials.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <a
            href={enableUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors shadow-sm"
          >
            <span>Enable in Console</span>
            <ExternalLink size={13} />
          </a>

          <button
            onClick={handleRetry}
            disabled={retrying}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition-colors cursor-pointer"
            title="Reload after enabling"
          >
            {retrying ? 'Refreshing...' : 'Retry'}
          </button>

          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Dismiss notice"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
