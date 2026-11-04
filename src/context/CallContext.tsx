import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  addDoc,
  serverTimestamp,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from './AuthContext';
import { CallSession, UserProfile } from '../types';
import { ICE_SERVERS, getMediaStream } from '../services/webrtc';
import { soundEffects } from '../services/soundEffects';
import { formatCallDuration, recordCallHistory } from '../services/callHistoryService';

interface CallContextType {
  activeCall: CallSession | null;
  incomingCall: CallSession | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  callDuration: number;
  callDurationFormatted: string;
  initiateCall: (callee: UserProfile, type: 'audio' | 'video') => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => Promise<void>;
  switchCamera: () => Promise<void>;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, userProfile } = useAuth();
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSession | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [callDuration, setCallDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<any>(null);
  const unsubCallRef = useRef<(() => void) | null>(null);
  const unsubCandidatesRef = useRef<(() => void) | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const callDurationRef = useRef<number>(0);
  const activeCallRef = useRef<CallSession | null>(null);

  // Sync ref with state
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    callDurationRef.current = callDuration;
  }, [callDuration]);

  // Clear timers & streams
  const cleanupMedia = () => {
    soundEffects.stopRingtone();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (unsubCallRef.current) {
      unsubCallRef.current();
      unsubCallRef.current = null;
    }
    if (unsubCandidatesRef.current) {
      unsubCandidatesRef.current();
      unsubCandidatesRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    connectedAtRef.current = null;
    callDurationRef.current = 0;
    activeCallRef.current = null;
    setRemoteStream(null);
    setActiveCall(null);
    setIncomingCall(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setCallDuration(0);
  };

  // Clean exit if page is closed or reloaded
  useEffect(() => {
    const handleExit = () => {
      if (activeCallRef.current) {
        const cur = activeCallRef.current;
        const dur = connectedAtRef.current
          ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
          : 0;
        recordCallHistory({
          callId: cur.id,
          callerId: cur.callerId,
          callerName: cur.callerName,
          callerPhoto: cur.callerPhoto,
          calleeId: cur.calleeId,
          calleeName: cur.calleeName,
          calleePhoto: cur.calleePhoto,
          type: cur.type,
          status: 'ended',
          duration: dur,
          connectedAt: connectedAtRef.current,
          endedAt: Date.now(),
        }).catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleExit);
    window.addEventListener('pagehide', handleExit);
    return () => {
      window.removeEventListener('beforeunload', handleExit);
      window.removeEventListener('pagehide', handleExit);
    };
  }, []);

  // Listen for incoming calls for the current user
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'calls'),
      where('calleeId', '==', currentUser.uid),
      where('status', 'in', ['offering', 'ringing'])
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const callDoc = snapshot.docs[0];
          const data = { id: callDoc.id, ...callDoc.data() } as CallSession;
          // If we're not currently on a call
          if (!activeCall && !incomingCall) {
            setIncomingCall(data);
            soundEffects.startIncomingRingtone();
          }
        } else {
          if (incomingCall) {
            soundEffects.stopRingtone();
            setIncomingCall(null);
          }
        }
      },
      (error) => {
        console.warn('Incoming calls listener notice:', error?.message || error);
      }
    );

    return () => unsubscribe();
  }, [currentUser, activeCall, incomingCall]);

  // Initiate an outgoing call
  const initiateCall = async (callee: UserProfile, type: 'audio' | 'video') => {
    if (!currentUser || !userProfile) return;

    try {
      cleanupMedia();
      soundEffects.startOutgoingRingtone();

      const stream = await getMediaStream(type, facingMode);
      setLocalStream(stream);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      // Add local tracks to peer connection
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Handle remote track
      const remote = new MediaStream();
      setRemoteStream(remote);
      pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
          remote.addTrack(track);
        });
      };

      const callDocRef = doc(collection(db, 'calls'));
      const callId = callDocRef.id;

      // Send local ICE candidates to Firestore
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          try {
            await addDoc(collection(db, 'calls', callId, 'candidates'), {
              senderId: currentUser.uid,
              candidate: event.candidate.toJSON(),
              createdAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn('Error adding ICE candidate:', e);
          }
        }
      };

      // Create offer
      const offerDescription = await pc.createOffer();
      await pc.setLocalDescription(offerDescription);

      const newCall: CallSession = {
        id: callId,
        callerId: currentUser.uid,
        callerName: userProfile.displayName,
        callerPhoto: userProfile.photoURL,
        calleeId: callee.uid,
        calleeName: callee.displayName,
        calleePhoto: callee.photoURL,
        type,
        status: 'ringing',
        offer: {
          type: offerDescription.type,
          sdp: offerDescription.sdp,
        },
        createdAt: new Date().toISOString(),
      };

      await setDoc(callDocRef, {
        ...newCall,
        createdAt: serverTimestamp(),
      });

      setActiveCall(newCall);
      activeCallRef.current = newCall;

      // Listen for answer and call state changes
      unsubCallRef.current = onSnapshot(
        callDocRef,
        async (snapshot) => {
          const data = snapshot.data();
          if (!data) return;

          if (data.status === 'accepted' && data.answer && !pc.currentRemoteDescription) {
            soundEffects.playCallConnected();
            const answerDescription = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(answerDescription);

            // Set connected timestamp
            const connTimestamp = data.connectedAt || Date.now();
            connectedAtRef.current = connTimestamp;
            setCallDuration(0);

            // Start accurate duration timer from connection timestamp
            if (!timerRef.current) {
              timerRef.current = setInterval(() => {
                if (connectedAtRef.current) {
                  const elapsed = Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000));
                  setCallDuration(elapsed);
                }
              }, 1000);
            }
            setActiveCall((prev) => (prev ? { ...prev, status: 'accepted', connectedAt: connTimestamp } : null));
          } else if (data.status === 'rejected' || data.status === 'ended') {
            soundEffects.playCallEnded();
            const finalDuration = connectedAtRef.current
              ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
              : 0;

            await recordCallHistory({
              callId,
              callerId: currentUser.uid,
              callerName: userProfile.displayName,
              callerPhoto: userProfile.photoURL,
              calleeId: callee.uid,
              calleeName: callee.displayName,
              calleePhoto: callee.photoURL,
              type,
              status: data.status,
              duration: finalDuration,
              connectedAt: connectedAtRef.current,
              endedAt: Date.now(),
            }).catch(() => {});

            cleanupMedia();
          }
        },
        (error) => {
          console.warn('CallDoc listener notice:', error?.message || error);
        }
      );

      // Listen for remote ICE candidates from callee
      const candidatesCol = collection(db, 'calls', callId, 'candidates');
      unsubCandidatesRef.current = onSnapshot(
        candidatesCol,
        (snap) => {
          snap.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const cData = change.doc.data();
              if (cData.senderId !== currentUser.uid && cData.candidate) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cData.candidate));
                } catch (err) {
                  console.warn('Error adding received ICE candidate:', err);
                }
              }
            }
          });
        },
        (error) => {
          console.warn('Candidates listener notice:', error?.message || error);
        }
      );
    } catch (err) {
      console.error('Failed to initiate call:', err);
      soundEffects.playCallEnded();
      cleanupMedia();
    }
  };

  // Accept incoming call
  const acceptCall = async () => {
    if (!incomingCall || !currentUser || !userProfile) return;

    soundEffects.stopRingtone();
    const callToAccept = incomingCall;
    setIncomingCall(null);

    try {
      const stream = await getMediaStream(callToAccept.type, facingMode);
      setLocalStream(stream);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const remote = new MediaStream();
      setRemoteStream(remote);
      pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
          remote.addTrack(track);
        });
      };

      const callDocRef = doc(db, 'calls', callToAccept.id);

      // Collect ICE candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          try {
            await addDoc(collection(db, 'calls', callToAccept.id, 'candidates'), {
              senderId: currentUser.uid,
              candidate: event.candidate.toJSON(),
              createdAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn('Error adding callee ICE candidate:', e);
          }
        }
      };

      // Set remote offer & create answer
      await pc.setRemoteDescription(new RTCSessionDescription(callToAccept.offer));
      const answerDescription = await pc.createAnswer();
      await pc.setLocalDescription(answerDescription);

      const connectedNow = Date.now();
      connectedAtRef.current = connectedNow;

      await updateDoc(callDocRef, {
        answer: {
          type: answerDescription.type,
          sdp: answerDescription.sdp,
        },
        status: 'accepted',
        connectedAt: connectedNow,
        acceptedAt: serverTimestamp(),
      });

      soundEffects.playCallConnected();
      const updatedAcceptedCall: CallSession = {
        ...callToAccept,
        status: 'accepted',
        connectedAt: connectedNow,
      };
      setActiveCall(updatedAcceptedCall);
      activeCallRef.current = updatedAcceptedCall;

      // Start duration timer
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        if (connectedAtRef.current) {
          const elapsed = Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000));
          setCallDuration(elapsed);
        }
      }, 1000);

      // Listen for call termination
      unsubCallRef.current = onSnapshot(
        callDocRef,
        async (snap) => {
          const data = snap.data();
          if (data && (data.status === 'ended' || data.status === 'rejected')) {
            soundEffects.playCallEnded();
            const finalDuration = connectedAtRef.current
              ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
              : 0;

            await recordCallHistory({
              callId: callToAccept.id,
              callerId: callToAccept.callerId,
              callerName: callToAccept.callerName,
              callerPhoto: callToAccept.callerPhoto,
              calleeId: callToAccept.calleeId,
              calleeName: callToAccept.calleeName,
              calleePhoto: callToAccept.calleePhoto,
              type: callToAccept.type,
              status: data.status,
              duration: finalDuration,
              connectedAt: connectedAtRef.current,
              endedAt: Date.now(),
            }).catch(() => {});

            cleanupMedia();
          }
        },
        (error) => {
          console.warn('Call termination listener notice:', error?.message || error);
        }
      );

      // Listen for caller's ICE candidates
      const candidatesCol = collection(db, 'calls', callToAccept.id, 'candidates');
      unsubCandidatesRef.current = onSnapshot(
        candidatesCol,
        (snap) => {
          snap.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const cData = change.doc.data();
              if (cData.senderId !== currentUser.uid && cData.candidate) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cData.candidate));
                } catch (e) {
                  console.warn('Error adding caller ICE candidate:', e);
                }
              }
            }
          });
        },
        (error) => {
          console.warn('Caller ICE candidates listener notice:', error?.message || error);
        }
      );
    } catch (err) {
      console.error('Failed to accept call:', err);
      soundEffects.playCallEnded();
      cleanupMedia();
    }
  };

  // Reject incoming call
  const rejectCall = async () => {
    soundEffects.stopRingtone();
    if (incomingCall) {
      const callToReject = incomingCall;
      try {
        const callDocRef = doc(db, 'calls', callToReject.id);
        await updateDoc(callDocRef, {
          status: 'rejected',
          endedAt: serverTimestamp(),
        });

        await recordCallHistory({
          callId: callToReject.id,
          callerId: callToReject.callerId,
          callerName: callToReject.callerName,
          callerPhoto: callToReject.callerPhoto,
          calleeId: callToReject.calleeId,
          calleeName: callToReject.calleeName,
          calleePhoto: callToReject.calleePhoto,
          type: callToReject.type,
          status: 'rejected',
          duration: 0,
          connectedAt: null,
          endedAt: Date.now(),
        }).catch(() => {});
      } catch (err) {
        console.warn('Error updating call rejection:', err);
      }
    }
    setIncomingCall(null);
  };

  // End active call
  const endCall = async () => {
    soundEffects.playCallEnded();
    const curCall = activeCallRef.current || activeCall;
    const finalDuration = connectedAtRef.current
      ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
      : callDurationRef.current || 0;

    if (curCall) {
      try {
        const callDocRef = doc(db, 'calls', curCall.id);
        await updateDoc(callDocRef, {
          status: 'ended',
          duration: finalDuration,
          endedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Error updating ended call in Firestore:', err);
      }

      await recordCallHistory({
        callId: curCall.id,
        callerId: curCall.callerId,
        callerName: curCall.callerName,
        callerPhoto: curCall.callerPhoto,
        calleeId: curCall.calleeId,
        calleeName: curCall.calleeName,
        calleePhoto: curCall.calleePhoto,
        type: curCall.type,
        status: 'ended',
        duration: finalDuration,
        connectedAt: connectedAtRef.current,
        endedAt: Date.now(),
      }).catch(() => {});
    }
    cleanupMedia();
  };

  // Toggle Microphone
  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle Camera
  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  // Switch Camera (Mobile front / rear)
  const switchCamera = async () => {
    if (!localStream || !pcRef.current) return;
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextMode },
        audio: false,
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track && s.track.kind === 'video');

      if (sender && newVideoTrack) {
        await sender.replaceTrack(newVideoTrack);
        // Replace in local stream
        const oldTrack = localStream.getVideoTracks()[0];
        if (oldTrack) {
          localStream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStream.addTrack(newVideoTrack);
      }
    } catch (err) {
      console.warn('Error switching camera:', err);
    }
  };

  // Screen Share Toggle
  const toggleScreenShare = async () => {
    if (!pcRef.current || !localStream) return;

    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        const sender = pcRef.current.getSenders().find((s) => s.track && s.track.kind === 'video');

        if (sender && screenTrack) {
          await sender.replaceTrack(screenTrack);
          setIsScreenSharing(true);

          screenTrack.onended = async () => {
            // Restore camera track
            const camStream = await getMediaStream('video', facingMode);
            const camTrack = camStream.getVideoTracks()[0];
            await sender.replaceTrack(camTrack);
            setIsScreenSharing(false);
          };
        }
      } catch (err) {
        console.warn('Screen share canceled or denied:', err);
      }
    } else {
      // Revert back to camera
      try {
        const camStream = await getMediaStream('video', facingMode);
        const camTrack = camStream.getVideoTracks()[0];
        const sender = pcRef.current.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender && camTrack) {
          await sender.replaceTrack(camTrack);
          setIsScreenSharing(false);
        }
      } catch (err) {
        console.warn('Failed restoring camera track:', err);
      }
    }
  };

  return (
    <CallContext.Provider
      value={{
        activeCall,
        incomingCall,
        localStream,
        remoteStream,
        isMuted,
        isVideoOff,
        isScreenSharing,
        callDuration,
        callDurationFormatted: formatCallDuration(callDuration),
        initiateCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMute,
        toggleVideo,
        toggleScreenShare,
        switchCamera,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
