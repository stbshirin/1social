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
} from 'firebase/firestore';
import {
  ref as rtdbRef,
  set as rtdbSet,
  update as rtdbUpdate,
  remove as rtdbRemove,
  onValue as rtdbOnValue,
  onDisconnect as rtdbOnDisconnect,
  serverTimestamp as rtdbServerTimestamp,
} from 'firebase/database';
import { db, rtdb } from '../firebase/config';
import { useAuth } from './AuthContext';
import { CallSession, UserProfile } from '../types';
import { ICE_SERVERS, getMediaStream, stopMediaStream } from '../services/webrtc';
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

  // Persistent refs to avoid closure stale state
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<any>(null);
  const unsubCallRef = useRef<(() => void) | null>(null);
  const unsubRtdbCallRef = useRef<(() => void) | null>(null);
  const unsubCandidatesRef = useRef<(() => void) | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const callDurationRef = useRef<number>(0);
  const activeCallRef = useRef<CallSession | null>(null);
  const isCleaningUpRef = useRef<boolean>(false);

  // Keep refs synchronized
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    callDurationRef.current = callDuration;
  }, [callDuration]);

  // Complete cleanup: Releases hardware (camera & mic), peer connection, listeners, and timers
  const cleanupMedia = () => {
    soundEffects.stopRingtone();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (unsubRtdbCallRef.current) {
      try {
        unsubRtdbCallRef.current();
      } catch (e) {}
      unsubRtdbCallRef.current = null;
    }

    if (unsubCallRef.current) {
      try {
        unsubCallRef.current();
      } catch (e) {}
      unsubCallRef.current = null;
    }

    if (unsubCandidatesRef.current) {
      try {
        unsubCandidatesRef.current();
      } catch (e) {}
      unsubCandidatesRef.current = null;
    }

    // Cancel RTDB onDisconnect if call was active
    if (activeCallRef.current?.id) {
      try {
        const callStatusRef = rtdbRef(rtdb, `calls/${activeCallRef.current.id}/status`);
        rtdbOnDisconnect(callStatusRef).cancel().catch(() => {});
      } catch (e) {}
    }

    // Immediately stop local media hardware (camera LED & microphone turn off)
    stopMediaStream(localStreamRef.current);
    localStreamRef.current = null;
    setLocalStream(null);

    // Stop remote media stream
    stopMediaStream(remoteStreamRef.current);
    remoteStreamRef.current = null;
    setRemoteStream(null);

    // Close WebRTC Peer Connection
    if (pcRef.current) {
      try {
        pcRef.current.getSenders().forEach((sender) => {
          if (sender.track) {
            try {
              sender.track.stop();
              sender.track.enabled = false;
            } catch (e) {}
          }
        });
        pcRef.current.close();
      } catch (e) {
        console.warn('Error closing peer connection:', e);
      }
      pcRef.current = null;
    }

    connectedAtRef.current = null;
    callDurationRef.current = 0;
    activeCallRef.current = null;

    setActiveCall(null);
    setIncomingCall(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setCallDuration(0);
    isCleaningUpRef.current = false;
  };

  // Graceful browser close / tab switch exit handler
  useEffect(() => {
    const handleExit = () => {
      const cur = activeCallRef.current;
      if (cur) {
        const dur = connectedAtRef.current
          ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
          : 0;

        try {
          rtdbUpdate(rtdbRef(rtdb, `calls/${cur.id}`), {
            status: 'ended',
            endedBy: currentUser?.uid || '',
            endedAt: Date.now(),
            duration: dur,
          }).catch(() => {});
        } catch (e) {}

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

        cleanupMedia();
      }
    };

    window.addEventListener('beforeunload', handleExit);
    window.addEventListener('pagehide', handleExit);
    return () => {
      window.removeEventListener('beforeunload', handleExit);
      window.removeEventListener('pagehide', handleExit);
    };
  }, [currentUser?.uid]);

  // Dual-listener for incoming calls: RTDB userCalls (instant <50ms) + Firestore fallback
  useEffect(() => {
    if (!currentUser) return;

    // 1. RTDB incoming calls listener
    const userCallsNode = rtdbRef(rtdb, `userCalls/${currentUser.uid}`);
    const unsubRtdb = rtdbOnValue(
      userCallsNode,
      (snapshot) => {
        const data = snapshot.val();
        if (data && typeof data === 'object') {
          const callList = Object.values(data) as CallSession[];
          const incoming = callList.find((c) => c.status === 'ringing' || c.status === 'offering');

          if (incoming && !activeCallRef.current) {
            setIncomingCall(incoming);
            soundEffects.startIncomingRingtone();
            return;
          }
        }

        // If no active incoming call in RTDB, silence ringtone if not in active call
        if (!activeCallRef.current && incomingCall) {
          soundEffects.stopRingtone();
          setIncomingCall(null);
        }
      },
      (error) => {
        console.warn('RTDB userCalls listener notice:', error?.message || error);
      }
    );

    // 2. Firestore incoming calls query fallback
    const q = query(
      collection(db, 'calls'),
      where('calleeId', '==', currentUser.uid),
      where('status', 'in', ['offering', 'ringing'])
    );

    const unsubFirestore = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const callDoc = snapshot.docs[0];
          const data = { id: callDoc.id, ...callDoc.data() } as CallSession;
          if (!activeCallRef.current && !incomingCall) {
            setIncomingCall(data);
            soundEffects.startIncomingRingtone();
          }
        } else if (!activeCallRef.current && incomingCall) {
          soundEffects.stopRingtone();
          setIncomingCall(null);
        }
      },
      (error) => {
        console.warn('Firestore incoming calls listener notice:', error?.message || error);
      }
    );

    return () => {
      unsubRtdb();
      unsubFirestore();
    };
  }, [currentUser?.uid, incomingCall]);

  // Initiate an outgoing Audio or Video Call
  const initiateCall = async (callee: UserProfile, type: 'audio' | 'video') => {
    if (!currentUser || !userProfile) return;

    try {
      cleanupMedia();
      soundEffects.startOutgoingRingtone();

      const stream = await getMediaStream(type, facingMode);
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      // Add local audio and video tracks to WebRTC peer connection
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Handle receiving remote tracks
      const remote = new MediaStream();
      remoteStreamRef.current = remote;
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
            console.warn('Error adding caller ICE candidate:', e);
          }
        }
      };

      // Create WebRTC Offer
      const offerDescription = await pc.createOffer();
      await pc.setLocalDescription(offerDescription);

      const newCallData: CallSession = {
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

      // 1. Dual-write to Realtime Database for sub-50ms signaling and server-side onDisconnect
      const rtdbCallRef = rtdbRef(rtdb, `calls/${callId}`);
      const rtdbCalleeCallRef = rtdbRef(rtdb, `userCalls/${callee.uid}/${callId}`);

      await Promise.all([
        rtdbSet(rtdbCallRef, {
          ...newCallData,
          createdAt: Date.now(),
        }),
        rtdbSet(rtdbCalleeCallRef, {
          ...newCallData,
          createdAt: Date.now(),
        }),
      ]);

      // Server-side onDisconnect ensures that if caller closes browser/loses net, callee terminates immediately
      try {
        await rtdbOnDisconnect(rtdbRef(rtdb, `calls/${callId}/status`)).set('ended');
        await rtdbOnDisconnect(rtdbRef(rtdb, `calls/${callId}/endedBy`)).set(currentUser.uid);
        await rtdbOnDisconnect(rtdbCalleeCallRef).remove();
      } catch (disconnectErr) {
        console.warn('onDisconnect registration notice:', disconnectErr);
      }

      // 2. Write to Firestore as persistent record
      await setDoc(callDocRef, {
        ...newCallData,
        createdAt: serverTimestamp(),
      });

      setActiveCall(newCallData);
      activeCallRef.current = newCallData;

      // Realtime listener for remote answer and instant disconnect synchronization via RTDB
      unsubRtdbCallRef.current = rtdbOnValue(
        rtdbCallRef,
        async (snapshot) => {
          const data = snapshot.val();
          if (!data) return;

          // Remote answered call
          if (data.status === 'accepted' && data.answer && !pc.currentRemoteDescription) {
            soundEffects.playCallConnected();
            const answerDescription = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(answerDescription);

            const connTimestamp = data.connectedAt || Date.now();
            connectedAtRef.current = connTimestamp;
            setCallDuration(0);

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
            // Immediate real-time remote disconnect!
            if (isCleaningUpRef.current) return;
            isCleaningUpRef.current = true;

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
          console.warn('RTDB call signaling listener notice:', error?.message || error);
        }
      );

      // Listen for remote ICE candidates from callee via Firestore
      const candidatesCol = collection(db, 'calls', callId, 'candidates');
      unsubCandidatesRef.current = onSnapshot(
        candidatesCol,
        (snap) => {
          snap.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const cData = change.doc.data();
              if (cData.senderId !== currentUser.uid && cData.candidate && pcRef.current) {
                try {
                  await pcRef.current.addIceCandidate(new RTCIceCandidate(cData.candidate));
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
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const remote = new MediaStream();
      remoteStreamRef.current = remote;
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

      // Set remote offer & generate answer
      await pc.setRemoteDescription(new RTCSessionDescription(callToAccept.offer));
      const answerDescription = await pc.createAnswer();
      await pc.setLocalDescription(answerDescription);

      const connectedNow = Date.now();
      connectedAtRef.current = connectedNow;

      // Update RTDB for instant connection
      const rtdbCallRef = rtdbRef(rtdb, `calls/${callToAccept.id}`);
      await rtdbUpdate(rtdbCallRef, {
        answer: {
          type: answerDescription.type,
          sdp: answerDescription.sdp,
        },
        status: 'accepted',
        connectedAt: connectedNow,
      });

      // Remove from userCalls
      await rtdbRemove(rtdbRef(rtdb, `userCalls/${currentUser.uid}/${callToAccept.id}`)).catch(() => {});

      // Server-side onDisconnect: if callee disconnects abruptly, mark call ended in RTDB
      try {
        await rtdbOnDisconnect(rtdbRef(rtdb, `calls/${callToAccept.id}/status`)).set('ended');
        await rtdbOnDisconnect(rtdbRef(rtdb, `calls/${callToAccept.id}/endedBy`)).set(currentUser.uid);
      } catch (disconnectErr) {
        console.warn('onDisconnect registration notice:', disconnectErr);
      }

      // Update Firestore
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

      // Listen for instantaneous call termination via RTDB
      unsubRtdbCallRef.current = rtdbOnValue(
        rtdbCallRef,
        async (snap) => {
          const data = snap.val();
          if (data && (data.status === 'ended' || data.status === 'rejected')) {
            if (isCleaningUpRef.current) return;
            isCleaningUpRef.current = true;

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
          console.warn('RTDB termination listener notice:', error?.message || error);
        }
      );

      // Listen for caller's ICE candidates via Firestore
      const candidatesCol = collection(db, 'calls', callToAccept.id, 'candidates');
      unsubCandidatesRef.current = onSnapshot(
        candidatesCol,
        (snap) => {
          snap.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const cData = change.doc.data();
              if (cData.senderId !== currentUser.uid && cData.candidate && pcRef.current) {
                try {
                  await pcRef.current.addIceCandidate(new RTCIceCandidate(cData.candidate));
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
        // Update RTDB status to rejected and remove from userCalls
        await rtdbUpdate(rtdbRef(rtdb, `calls/${callToReject.id}`), {
          status: 'rejected',
          endedAt: Date.now(),
        }).catch(() => {});

        await rtdbRemove(rtdbRef(rtdb, `userCalls/${currentUser?.uid}/${callToReject.id}`)).catch(() => {});

        // Update Firestore status
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

  // End active call (caller or callee clicks "End Call")
  const endCall = async () => {
    soundEffects.playCallEnded();
    const curCall = activeCallRef.current || activeCall;
    const finalDuration = connectedAtRef.current
      ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
      : callDurationRef.current || 0;

    if (curCall) {
      isCleaningUpRef.current = true;

      // 1. Immediately update RTDB to trigger instant disconnect on remote device
      try {
        await rtdbUpdate(rtdbRef(rtdb, `calls/${curCall.id}`), {
          status: 'ended',
          duration: finalDuration,
          endedBy: currentUser?.uid || '',
          endedAt: Date.now(),
        });
        await rtdbRemove(rtdbRef(rtdb, `userCalls/${curCall.calleeId}/${curCall.id}`)).catch(() => {});
      } catch (rtdbErr) {
        console.warn('RTDB end call notice:', rtdbErr);
      }

      // 2. Update Firestore
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

      // 3. Record call history with exact duration
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

    // Immediately stop local media hardware (camera LED & mic) and cleanup
    cleanupMedia();
  };

  // Toggle Microphone Mute
  const toggleMute = () => {
    const stream = localStreamRef.current || localStream;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle Camera
  const toggleVideo = () => {
    const stream = localStreamRef.current || localStream;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  // Switch Camera (Mobile front / rear)
  const switchCamera = async () => {
    const stream = localStreamRef.current || localStream;
    if (!stream || !pcRef.current) return;

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
        const oldTrack = stream.getVideoTracks()[0];
        if (oldTrack) {
          stream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        stream.addTrack(newVideoTrack);
      }
    } catch (err) {
      console.warn('Error switching camera:', err);
    }
  };

  // Screen Share Toggle
  const toggleScreenShare = async () => {
    const stream = localStreamRef.current || localStream;
    if (!pcRef.current || !stream) return;

    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        const sender = pcRef.current.getSenders().find((s) => s.track && s.track.kind === 'video');

        if (sender && screenTrack) {
          await sender.replaceTrack(screenTrack);
          setIsScreenSharing(true);

          screenTrack.onended = async () => {
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
