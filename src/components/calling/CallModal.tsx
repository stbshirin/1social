import React, { useEffect, useRef, useState } from 'react';
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  ScreenShare,
  Maximize2,
  Minimize2,
  SwitchCamera,
  User,
} from 'lucide-react';
import { useCall } from '../../context/CallContext';

export const CallModal: React.FC = () => {
  const {
    activeCall,
    incomingCall,
    localStream,
    remoteStream,
    isMuted,
    isVideoOff,
    isScreenSharing,
    callDuration,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    switchCamera,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Bind local stream to local video tag
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, activeCall]);

  // Bind remote stream to remote video tag
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, activeCall]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullScreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullScreen(false);
    }
  };

  // If there's an incoming call
  if (incomingCall && !activeCall) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl text-white">
          <div className="relative inline-block mb-6">
            <div className="absolute -inset-3 rounded-full bg-emerald-500/20 animate-ping" />
            <img
              src={incomingCall.callerPhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${incomingCall.callerId}`}
              alt={incomingCall.callerName}
              className="relative w-24 h-24 rounded-full border-4 border-emerald-500 object-cover shadow-lg mx-auto"
            />
          </div>

          <h3 className="text-xl font-bold text-white mb-1">{incomingCall.callerName}</h3>
          <p className="text-sm text-emerald-400 font-medium mb-6 flex items-center justify-center gap-1.5">
            {incomingCall.type === 'video' ? <Video size={16} /> : <Phone size={16} />}
            Incoming {incomingCall.type === 'video' ? 'Video' : 'Audio'} Call...
          </p>

          <div className="flex items-center justify-center gap-6">
            <button
              onClick={rejectCall}
              className="flex flex-col items-center gap-1 text-xs text-rose-400 group cursor-pointer"
            >
              <div className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-lg transition-transform group-hover:scale-105 active:scale-95">
                <PhoneOff size={24} />
              </div>
              <span>Decline</span>
            </button>

            <button
              onClick={acceptCall}
              className="flex flex-col items-center gap-1 text-xs text-emerald-400 group cursor-pointer"
            >
              <div className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-lg transition-transform group-hover:scale-105 active:scale-95 animate-pulse">
                <Phone size={24} />
              </div>
              <span>Accept</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If there is an active call
  if (!activeCall) return null;

  const isVideo = activeCall.type === 'video';

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white select-none overflow-hidden"
    >
      {/* Top Header Bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-3">
          <img
            src={activeCall.calleePhoto || activeCall.callerPhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=pulse`}
            alt="participant"
            className="w-10 h-10 rounded-full border border-white/20 object-cover"
          />
          <div>
            <h4 className="font-semibold text-sm sm:text-base leading-tight">
              {activeCall.calleeName || activeCall.callerName}
            </h4>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span className={`w-2 h-2 rounded-full ${activeCall.status === 'accepted' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              {activeCall.status === 'accepted'
                ? formatDuration(callDuration)
                : 'Ringing / Connecting...'}
            </div>
          </div>
        </div>

        <button
          onClick={toggleFullScreen}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition-colors"
          title="Toggle Fullscreen"
        >
          {isFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>

      {/* Main View Area */}
      <div className="relative flex-1 flex items-center justify-center w-full h-full bg-slate-900">
        {isVideo ? (
          <>
            {/* Remote Video Stream */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover sm:object-contain bg-black"
            />

            {/* If remote stream is not loaded or audio-only */}
            {(!remoteStream || remoteStream.getVideoTracks().length === 0) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-slate-300 p-4">
                <div className="w-28 h-28 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center mb-4 overflow-hidden">
                  <User size={56} className="text-slate-400" />
                </div>
                <p className="text-sm font-medium">Waiting for video stream...</p>
                <p className="text-xs text-slate-500 mt-1">WebRTC peer connection in progress</p>
              </div>
            )}

            {/* Inset Local Video Stream */}
            <div className="absolute bottom-24 right-4 sm:bottom-28 sm:right-6 w-32 h-44 sm:w-48 sm:h-64 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-slate-800 z-10 transition-transform hover:scale-105">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${!isScreenSharing ? '-scale-x-100' : ''}`}
              />
              {isVideoOff && (
                <div className="absolute inset-0 bg-slate-900 flex items-center justify-center text-slate-400 text-xs">
                  <VideoOff size={24} />
                </div>
              )}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-[10px] text-white">
                You
              </div>
            </div>
          </>
        ) : (
          /* Audio-only Call UI */
          <div className="flex flex-col items-center justify-center text-center p-6">
            <div className="relative mb-6">
              <div className="absolute -inset-4 rounded-full bg-emerald-500/10 animate-ping" />
              <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full border-4 border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden shadow-2xl">
                <img
                  src={activeCall.calleePhoto || activeCall.callerPhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=pulse`}
                  alt="avatar"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {activeCall.calleeName || activeCall.callerName}
            </h2>
            <p className="text-emerald-400 text-sm font-medium mb-1">
              {activeCall.status === 'accepted' ? '1 social HD Audio Call' : 'Connecting Audio Call...'}
            </p>
            <p className="text-slate-400 text-xs font-mono">
              {formatDuration(callDuration)}
            </p>

            {/* Hidden audio element for remote stream */}
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="absolute bottom-6 inset-x-0 z-20 flex items-center justify-center gap-3 sm:gap-4 px-4">
        {/* Toggle Audio Mute */}
        <button
          onClick={toggleMute}
          className={`p-3.5 sm:p-4 rounded-full backdrop-blur-md transition-all shadow-lg ${
            isMuted ? 'bg-rose-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
          }`}
          title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {/* Toggle Camera (if video call) */}
        {isVideo && (
          <button
            onClick={toggleVideo}
            className={`p-3.5 sm:p-4 rounded-full backdrop-blur-md transition-all shadow-lg ${
              isVideoOff ? 'bg-rose-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
            }`}
            title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
          >
            {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
          </button>
        )}

        {/* Switch Camera (mobile) */}
        {isVideo && (
          <button
            onClick={switchCamera}
            className="p-3.5 sm:p-4 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white backdrop-blur-md transition-all shadow-lg"
            title="Switch Camera (Front/Back)"
          >
            <SwitchCamera size={20} />
          </button>
        )}

        {/* Screen Share (if desktop/video) */}
        {isVideo && (
          <button
            onClick={toggleScreenShare}
            className={`p-3.5 sm:p-4 rounded-full backdrop-blur-md transition-all shadow-lg hidden sm:flex ${
              isScreenSharing ? 'bg-indigo-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
            }`}
            title="Share Screen"
          >
            <ScreenShare size={20} />
          </button>
        )}

        {/* End Call */}
        <button
          onClick={endCall}
          className="p-3.5 sm:p-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white transition-transform hover:scale-105 active:scale-95 shadow-xl flex items-center justify-center"
          title="End Call"
        >
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
};
