export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

export async function getMediaStream(type: 'audio' | 'video', facingMode: 'user' | 'environment' = 'user'): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: type === 'video' ? {
      facingMode,
      width: { ideal: 1280 },
      height: { ideal: 720 },
    } : false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.error('Error acquiring media stream:', err);
    // Fallback: If camera is busy or denied, fallback to audio-only if possible
    if (type === 'video') {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    throw err;
  }
}
