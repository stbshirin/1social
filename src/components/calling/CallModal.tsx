import React, { useEffect, useRef, useState } from 'react';
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
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
    isSpeakerOn,
    toggleSpeaker,
    callDurationFormatted,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    switchCamera,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const outgoingVideoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Bind local stream to local video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
    if (outgoingVideoPreviewRef.current && localStream) {
      outgoingVideoPreviewRef.current.srcObject = localStream;
    }
  }, [localStream, activeCall]);

  // Bind remote stream to remote video element
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      if ('volume' in remoteVideoRef.current) {
        remoteVideoRef.current.volume = isSpeakerOn ? 1.0 : 0.2;
      }
    }
  }, [remoteStream, activeCall, isSpeakerOn]);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullScreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullScreen(false);
    }
  };

  // =========================================================================
  // 1. INCOMING CALL SCREEN (Callee receives call from Caller)
  // =========================================================================
  if (incomingCall && !activeCall) {
    const isVideo = incomingCall.type === 'video';
    const callerPhoto =
      incomingCall.callerPhoto ||
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${incomingCall.callerId}`;
    const callerName = incomingCall.callerName || 'Incoming Call';
    const callerUsername = incomingCall.callerUsername
      ? `@${incomingCall.callerUsername}`
      : '@user';

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
        <div className="relative bg-slate-900/95 border border-slate-700/80 rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl text-white overflow-hidden">
          {/* Subtle gradient backdrop ring */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl" />

          {/* Caller Profile Avatar with Multi-layer Pulse Animation */}
          <div className="relative inline-block my-4">
            <div className="absolute -inset-4 rounded-full bg-emerald-500/20 animate-ping" />
            <div className="absolute -inset-8 rounded-full bg-emerald-500/10 animate-pulse" />
            <img
              src={callerPhoto}
              alt={callerName}
              className="relative w-28 h-28 rounded-full border-4 border-emerald-500 object-cover shadow-2xl mx-auto bg-slate-800"
            />
          </div>

          {/* Caller Details */}
          <div className="mt-2 mb-6">
            <h3 className="text-xl sm:text-2xl font-black text-white truncate px-2">{callerName}</h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{callerUsername}</p>

            {/* Badge indicating call type */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 mt-3 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              {isVideo ? <Video size={14} className="animate-pulse" /> : <Phone size={14} className="animate-pulse" />}
              <span>Incoming {isVideo ? 'Video' : 'Audio'} Call...</span>
            </div>
          </div>

          {/* Action Buttons: Decline or Accept */}
          <div className="flex items-center justify-center gap-8 pt-2">
            {/* Decline Button */}
            <button
              onClick={rejectCall}
              className="flex flex-col items-center gap-1.5 text-xs text-rose-400 group cursor-pointer focus:outline-none"
            >
              <div className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-rose-600/30 transition-transform">
                <PhoneOff size={26} />
              </div>
              <span className="font-semibold text-slate-300 group-hover:text-rose-400 transition-colors">
                Decline
              </span>
            </button>

            {/* Accept Button */}
            <button
              onClick={acceptCall}
              className="flex flex-col items-center gap-1.5 text-xs text-emerald-400 group cursor-pointer focus:outline-none"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 transition-transform animate-pulse">
                <Phone size={26} />
              </div>
              <span className="font-semibold text-slate-300 group-hover:text-emerald-400 transition-colors">
                Accept
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If no active call, don't render anything
  if (!activeCall) return null;

  const isVideo = activeCall.type === 'video';
  const isRinging = activeCall.status === 'ringing' || activeCall.status === 'offering';
  const otherPhoto =
    activeCall.calleePhoto ||
    activeCall.callerPhoto ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=pulse`;
  const otherName = activeCall.calleeName || activeCall.callerName || '1 social Member';
  const otherUsername = activeCall.calleeUsername
    ? `@${activeCall.calleeUsername}`
    : activeCall.callerUsername
    ? `@${activeCall.callerUsername}`
    : '@user';

  // =========================================================================
  // 2. OUTGOING CALLING SCREEN (User A is calling User B, waiting for answer)
  // =========================================================================
  if (isRinging) {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-slate-950 text-white p-6 select-none overflow-hidden"
      >
        {/* Background ambient lighting */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header */}
        <div className="w-full max-w-md flex items-center justify-between z-10 pt-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
            <span className="text-xs font-semibold text-amber-400 tracking-wide uppercase">
              {isVideo ? 'Outgoing Video Call' : 'Outgoing Audio Call'}
            </span>
          </div>

          <button
            onClick={toggleFullScreen}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            title="Toggle Fullscreen"
          >
            {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>

        {/* Central Callee Information & Animation */}
        <div className="flex flex-col items-center justify-center text-center z-10 my-auto">
          {/* Callee Profile Avatar with Outgoing Wave Rings */}
          <div className="relative mb-6">
            <div className="absolute -inset-4 rounded-full bg-indigo-500/20 animate-ping" />
            <div className="absolute -inset-8 rounded-full bg-indigo-500/10 animate-pulse" />
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full border-4 border-indigo-500/60 p-1 shadow-2xl relative bg-slate-900">
              <img
                src={otherPhoto}
                alt={otherName}
                className="w-full h-full rounded-full object-cover"
              />
            </div>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-white mb-1 px-4">{otherName}</h2>
          <p className="text-xs sm:text-sm text-slate-400 font-mono mb-4">{otherUsername}</p>

          {/* Animated Calling / Ringing status indicator */}
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 text-xs text-indigo-400 font-medium">
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            <span>Ringing... waiting for answer</span>
          </div>

          {/* If video call: show local camera preview so caller sees themselves while waiting */}
          {isVideo && (
            <div className="mt-6 w-36 h-48 sm:w-44 sm:h-56 rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl bg-slate-900 relative">
              <video
                ref={outgoingVideoPreviewRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${!isScreenSharing ? '-scale-x-100' : ''}`}
              />
              {isVideoOff && (
                <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center text-slate-400 text-xs gap-1">
                  <VideoOff size={22} />
                  <span>Camera off</span>
                </div>
              )}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-[10px] text-white font-medium">
                Your Camera
              </div>
            </div>
          )}
        </div>

        {/* Bottom Cancel & Controls Bar */}
        <div className="w-full max-w-md flex flex-col items-center gap-4 z-10 pb-6">
          <div className="flex items-center gap-4">
            {/* Toggle Mic */}
            <button
              onClick={toggleMute}
              className={`p-3.5 rounded-full backdrop-blur-md transition-all shadow-md cursor-pointer ${
                isMuted ? 'bg-rose-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
              }`}
              title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            {/* Toggle Camera (for video) */}
            {isVideo && (
              <button
                onClick={toggleVideo}
                className={`p-3.5 rounded-full backdrop-blur-md transition-all shadow-md cursor-pointer ${
                  isVideoOff ? 'bg-rose-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
                }`}
                title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
              >
                {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>
            )}

            {/* Switch Camera (for mobile video) */}
            {isVideo && (
              <button
                onClick={switchCamera}
                className="p-3.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white backdrop-blur-md transition-all shadow-md cursor-pointer"
                title="Switch Camera (Front/Back)"
              >
                <SwitchCamera size={20} />
              </button>
            )}

            {/* Cancel Call Button */}
            <button
              onClick={endCall}
              className="px-6 py-3.5 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-transform cursor-pointer"
              title="Cancel Call"
            >
              <PhoneOff size={20} />
              <span>Cancel Call</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. ACTIVE CONNECTED CALL SCREEN (status === 'accepted')
  // =========================================================================
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-white select-none overflow-hidden"
    >
      {/* Top Header Bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-3">
          <img
            src={otherPhoto}
            alt={otherName}
            className="w-10 h-10 rounded-full border border-white/20 object-cover bg-slate-800"
          />
          <div>
            <h4 className="font-semibold text-sm sm:text-base leading-tight truncate max-w-xs sm:max-w-md">
              {otherName}
            </h4>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono font-medium">{callDurationFormatted}</span>
              <span className="text-slate-400 text-[11px] hidden sm:inline">
                • {isVideo ? 'HD Video Call' : 'HD Audio Call'}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={toggleFullScreen}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition-colors cursor-pointer"
          title="Toggle Fullscreen"
        >
          {isFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>

      {/* Main View Area */}
      <div className="relative flex-1 flex items-center justify-center w-full h-full bg-slate-900">
        {isVideo ? (
          /* ================= ACTIVE VIDEO CALL UI ================= */
          <>
            {/* Remote Fullscreen Video Stream */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover sm:object-contain bg-black"
            />

            {/* Fallback if remote video track is inactive or loading */}
            {(!remoteStream || remoteStream.getVideoTracks().length === 0) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-slate-300 p-4">
                <div className="w-28 h-28 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center mb-4 overflow-hidden">
                  <User size={56} className="text-slate-400" />
                </div>
                <p className="text-sm font-semibold">{otherName}</p>
                <p className="text-xs text-slate-400 mt-1">Connecting HD Video Stream...</p>
              </div>
            )}

            {/* Inset Local Camera Preview Window (Picture-in-Picture) */}
            <div className="absolute bottom-24 right-4 sm:bottom-28 sm:right-6 w-32 h-44 sm:w-48 sm:h-64 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-slate-800 z-10 transition-transform hover:scale-105">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${!isScreenSharing ? '-scale-x-100' : ''}`}
              />
              {isVideoOff && (
                <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center text-slate-400 text-xs gap-1">
                  <VideoOff size={24} />
                  <span>Camera Off</span>
                </div>
              )}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-[10px] text-white font-medium">
                You
              </div>
            </div>
          </>
        ) : (
          /* ================= ACTIVE AUDIO CALL UI ================= */
          <div className="flex flex-col items-center justify-center text-center p-6">
            <div className="relative mb-6">
              <div className="absolute -inset-4 rounded-full bg-emerald-500/10 animate-ping" />
              <div className="absolute -inset-8 rounded-full bg-emerald-500/5 animate-pulse" />
              <div className="w-32 h-32 sm:w-44 sm:h-44 rounded-full border-4 border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden shadow-2xl">
                <img
                  src={otherPhoto}
                  alt={otherName}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white mb-1 px-4">{otherName}</h2>
            <p className="text-xs sm:text-sm text-slate-400 font-mono mb-2">{otherUsername}</p>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>1 social HD Audio Call</span>
            </div>

            <p className="text-xl sm:text-2xl text-white font-mono font-bold tracking-wider">
              {callDurationFormatted}
            </p>

            {/* Hidden video element to play remote audio stream */}
            <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
          </div>
        )}
      </div>

      {/* Floating Bottom Controls Bar */}
      <div className="absolute bottom-6 inset-x-0 z-20 flex items-center justify-center gap-3 sm:gap-4 px-4">
        {/* Toggle Audio Mute */}
        <button
          onClick={toggleMute}
          className={`p-3.5 sm:p-4 rounded-full backdrop-blur-md transition-all shadow-lg cursor-pointer ${
            isMuted ? 'bg-rose-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
          }`}
          title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {/* Toggle Camera (if video call) */}
        {isVideo && (
          <button
            onClick={toggleVideo}
            className={`p-3.5 sm:p-4 rounded-full backdrop-blur-md transition-all shadow-lg cursor-pointer ${
              isVideoOff ? 'bg-rose-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
            }`}
            title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
          >
            {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
          </button>
        )}

        {/* Switch Camera (Front/Rear for mobile video call) */}
        {isVideo && (
          <button
            onClick={switchCamera}
            className="p-3.5 sm:p-4 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white backdrop-blur-md transition-all shadow-lg cursor-pointer"
            title="Switch Camera (Front/Back)"
          >
            <SwitchCamera size={20} />
          </button>
        )}

        {/* Screen Share (if desktop video call) */}
        {isVideo && (
          <button
            onClick={toggleScreenShare}
            className={`p-3.5 sm:p-4 rounded-full backdrop-blur-md transition-all shadow-lg hidden sm:flex cursor-pointer ${
              isScreenSharing ? 'bg-indigo-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
            }`}
            title="Share Screen"
          >
            <ScreenShare size={20} />
          </button>
        )}

        {/* Speaker Button (for audio call) */}
        {!isVideo && (
          <button
            onClick={toggleSpeaker}
            className={`p-3.5 sm:p-4 rounded-full backdrop-blur-md transition-all shadow-lg cursor-pointer ${
              isSpeakerOn ? 'bg-slate-800/80 hover:bg-slate-700 text-white' : 'bg-amber-600 text-white'
            }`}
            title={isSpeakerOn ? 'Speaker On' : 'Speaker Off'}
          >
            {isSpeakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        )}

        {/* End Call Button */}
        <button
          onClick={endCall}
          className="p-3.5 sm:p-4 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white transition-transform hover:scale-105 shadow-xl flex items-center justify-center cursor-pointer"
          title="End Call"
        >
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
};
