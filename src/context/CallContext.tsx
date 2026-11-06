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
  isSpeakerOn: boolean;
  toggleSpeaker: () => void;
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
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
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

    // Close WebRTC Peer Connection and stop senders
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

  // Reliable incoming calls listener using Firestore primary + RTDB accelerator
  useEffect(() => {
    if (!currentUser?.uid) return;

    // 1. Authoritative Firestore incoming calls listener
    const q = query(
      collection(db, 'calls'),
      where('calleeId', '==', currentUser.uid),
      where('status', '==', 'ringing')
    );

    const unsubFirestore = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const callDoc = snapshot.docs[0];
          const data = { id: callDoc.id, ...callDoc.data() } as CallSession;
          // Only show incoming if we're not currently on an active call
          if (!activeCallRef.current || activeCallRef.current.status !== 'accepted') {
            setIncomingCall((prev) => {
              if (prev?.id === data.id) return prev;
              soundEffects.startIncomingRingtone();
              return data;
            });
          }
        } else {
          // If no ringing calls for this user in Firestore, dismiss incoming screen and stop ringtone
          setIncomingCall((prev) => {
            if (prev) {
              soundEffects.stopRingtone();
            }
            return null;
          });
        }
      },
      (error) => {
        console.warn('Firestore incoming calls listener notice:', error?.message || error);
      }
    );

    // 2. Non-blocking RTDB incoming accelerator
    let unsubRtdb: (() => void) | null = null;
    try {
      const userCallsNode = rtdbRef(rtdb, `userCalls/${currentUser.uid}`);
      unsubRtdb = rtdbOnValue(
        userCallsNode,
        (snapshot) => {
          const data = snapshot.val();
          if (data && typeof data === 'object') {
            const callList = Object.values(data) as CallSession[];
            const incoming = callList.find((c) => c.status === 'ringing' || c.status === 'offering');
            if (incoming && (!activeCallRef.current || activeCallRef.current.status !== 'accepted')) {
              setIncomingCall((prev) => {
                if (prev?.id === incoming.id) return prev;
                soundEffects.startIncomingRingtone();
                return incoming;
              });
            }
          }
        },
        (error) => {
          console.warn('RTDB incoming call notice (using Firestore):', error?.message || error);
        }
      );
    } catch (e) {}

    return () => {
      unsubFirestore();
      if (unsubRtdb) unsubRtdb();
    };
  }, [currentUser?.uid]);

  // Initiate an outgoing Audio or Video Call
  const initiateCall = async (callee: UserProfile, type: 'audio' | 'video') => {
    if (!currentUser) return;

    const myName = userProfile?.displayName || currentUser.displayName || currentUser.email?.split('@')[0] || 'User';
    const myUsername = userProfile?.username || currentUser.email?.split('@')[0] || `user_${currentUser.uid.slice(0, 5)}`;
    const myPhoto = userProfile?.photoURL || currentUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.uid}`;

    const callDocRef = doc(collection(db, 'calls'));
    const callId = callDocRef.id;

    // STEP 1: IMMEDIATELY SHOW OUTGOING CALL SCREEN (0ms latency!)
    cleanupMedia();
    soundEffects.startOutgoingRingtone();

    const initialCallData: CallSession = {
      id: callId,
      callerId: currentUser.uid,
      callerName: myName,
      callerUsername: myUsername,
      callerPhoto: myPhoto,
      calleeId: callee.uid,
      calleeName: callee.displayName || '1 social Member',
      calleeUsername: callee.username || 'user',
      calleePhoto: callee.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${callee.uid}`,
      type,
      status: 'ringing',
      createdAt: new Date().toISOString(),
    };

    setActiveCall(initialCallData);
    activeCallRef.current = initialCallData;

    try {
      // STEP 2: Acquire Media Stream with Graceful Fallback
      let stream: MediaStream;
      try {
        stream = await getMediaStream(type, facingMode);
      } catch (mediaErr: any) {
        console.warn('getUserMedia error, falling back to audio:', mediaErr);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch {
          // If no media device is available, create empty stream so WebRTC signaling continues
          stream = new MediaStream();
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);

      // STEP 3: Setup RTCPeerConnection
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

      // Collect ICE candidates
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

      const fullCallData: CallSession = {
        ...initialCallData,
        offer: {
          type: offerDescription.type,
          sdp: offerDescription.sdp,
        },
      };

      // Update local state with offer
      setActiveCall(fullCallData);
      activeCallRef.current = fullCallData;

      // STEP 4: Write Offer to Firestore calls collection
      await setDoc(callDocRef, {
        ...fullCallData,
        createdAt: serverTimestamp(),
      });

      // Secondary non-blocking write to Realtime Database
      try {
        const rtdbCallRef = rtdbRef(rtdb, `calls/${callId}`);
        const rtdbCalleeCallRef = rtdbRef(rtdb, `userCalls/${callee.uid}/${callId}`);

        await Promise.all([
          rtdbSet(rtdbCallRef, { ...fullCallData, createdAt: Date.now() }),
          rtdbSet(rtdbCalleeCallRef, { ...fullCallData, createdAt: Date.now() }),
        ]);

        rtdbOnDisconnect(rtdbRef(rtdb, `calls/${callId}/status`)).set('ended').catch(() => {});
        rtdbOnDisconnect(rtdbCalleeCallRef).remove().catch(() => {});
      } catch (rtdbErr) {
        console.warn('RTDB non-blocking write notice:', rtdbErr);
      }

      // Handler when call is accepted by remote user
      const handleRemoteAccepted = async (answer: any, connectedAt?: number) => {
        if (!pcRef.current || pcRef.current.currentRemoteDescription) return;

        soundEffects.playCallConnected();
        const answerDescription = new RTCSessionDescription(answer);
        await pcRef.current.setRemoteDescription(answerDescription);

        const connTimestamp = connectedAt || Date.now();
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
      };

      // Handler when call is terminated or rejected by remote user
      const handleRemoteTerminated = async (status: 'rejected' | 'ended') => {
        if (isCleaningUpRef.current) return;
        isCleaningUpRef.current = true;

        soundEffects.playCallEnded();
        const finalDuration = connectedAtRef.current
          ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
          : 0;

        await recordCallHistory({
          callId,
          callerId: currentUser.uid,
          callerName: myName,
          callerPhoto: myPhoto,
          calleeId: callee.uid,
          calleeName: callee.displayName || '1 social Member',
          calleePhoto: callee.photoURL,
          type,
          status,
          duration: finalDuration,
          connectedAt: connectedAtRef.current,
          endedAt: Date.now(),
        }).catch(() => {});

        cleanupMedia();
      };

      // Listen for remote answer / termination via Firestore
      unsubCallRef.current = onSnapshot(
        callDocRef,
        async (snapshot) => {
          const data = snapshot.data();
          if (!data) return;

          if (data.status === 'accepted' && data.answer) {
            await handleRemoteAccepted(data.answer, data.connectedAt);
          } else if (data.status === 'rejected' || data.status === 'ended') {
            await handleRemoteTerminated(data.status);
          }
        },
        (error) => {
          console.warn('Firestore callDoc listener notice:', error?.message || error);
        }
      );

      // Parallel RTDB listener for sub-50ms termination
      try {
        const rtdbCallRef = rtdbRef(rtdb, `calls/${callId}`);
        unsubRtdbCallRef.current = rtdbOnValue(
          rtdbCallRef,
          async (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            if (data.status === 'accepted' && data.answer) {
              await handleRemoteAccepted(data.answer, data.connectedAt);
            } else if (data.status === 'rejected' || data.status === 'ended') {
              await handleRemoteTerminated(data.status);
            }
          },
          (error) => {
            console.warn('RTDB call listener notice:', error?.message || error);
          }
        );
      } catch (e) {}

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
    if (!incomingCall || !currentUser) return;

    soundEffects.stopRingtone();
    const callToAccept = incomingCall;

    // STEP 1: IMMEDIATELY TRANSITION TO CONNECTED ACTIVE CALL SCREEN (0ms latency!)
    const connectedNow = Date.now();
    connectedAtRef.current = connectedNow;

    const acceptedCallData: CallSession = {
      ...callToAccept,
      status: 'accepted',
      connectedAt: connectedNow,
    };
    setActiveCall(acceptedCallData);
    activeCallRef.current = acceptedCallData;
    setIncomingCall(null);

    // Start duration timer immediately
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      if (connectedAtRef.current) {
        const elapsed = Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000));
        setCallDuration(elapsed);
      }
    }, 1000);

    try {
      // STEP 2: Acquire Media Stream with Fallback
      let stream: MediaStream;
      try {
        stream = await getMediaStream(callToAccept.type, facingMode);
      } catch (mediaErr: any) {
        console.warn('getUserMedia error in acceptCall:', mediaErr);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch {
          stream = new MediaStream();
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);

      // STEP 3: Setup RTCPeerConnection & Answer
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

      // STEP 4: Update Firestore with answer and accepted status
      await updateDoc(callDocRef, {
        answer: {
          type: answerDescription.type,
          sdp: answerDescription.sdp,
        },
        status: 'accepted',
        connectedAt: connectedNow,
        acceptedAt: serverTimestamp(),
      });

      // Update RTDB non-blockingly
      try {
        const rtdbCallRef = rtdbRef(rtdb, `calls/${callToAccept.id}`);
        await rtdbUpdate(rtdbCallRef, {
          answer: {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
          },
          status: 'accepted',
          connectedAt: connectedNow,
        });
        await rtdbRemove(rtdbRef(rtdb, `userCalls/${currentUser.uid}/${callToAccept.id}`));
        await rtdbOnDisconnect(rtdbRef(rtdb, `calls/${callToAccept.id}/status`)).set('ended');
      } catch (e) {}

      soundEffects.playCallConnected();

      // Termination listener
      const handleCallEnded = async () => {
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
          status: 'ended',
          duration: finalDuration,
          connectedAt: connectedAtRef.current,
          endedAt: Date.now(),
        }).catch(() => {});

        cleanupMedia();
      };

      // Listen via Firestore
      unsubCallRef.current = onSnapshot(
        callDocRef,
        async (snap) => {
          const data = snap.data();
          if (data && (data.status === 'ended' || data.status === 'rejected')) {
            await handleCallEnded();
          }
        },
        (error) => {
          console.warn('Firestore call termination listener notice:', error?.message || error);
        }
      );

      // Parallel RTDB listener
      try {
        const rtdbCallRef = rtdbRef(rtdb, `calls/${callToAccept.id}`);
        unsubRtdbCallRef.current = rtdbOnValue(
          rtdbCallRef,
          async (snap) => {
            const data = snap.val();
            if (data && (data.status === 'ended' || data.status === 'rejected')) {
              await handleCallEnded();
            }
          },
          (error) => {
            console.warn('RTDB termination listener notice:', error?.message || error);
          }
        );
      } catch (e) {}

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
      setIncomingCall(null);

      try {
        // Update Firestore status
        const callDocRef = doc(db, 'calls', callToReject.id);
        await updateDoc(callDocRef, {
          status: 'rejected',
          endedAt: serverTimestamp(),
        });

        // Update RTDB non-blockingly
        try {
          await rtdbUpdate(rtdbRef(rtdb, `calls/${callToReject.id}`), {
            status: 'rejected',
            endedAt: Date.now(),
          });
          await rtdbRemove(rtdbRef(rtdb, `userCalls/${currentUser?.uid}/${callToReject.id}`));
        } catch (e) {}

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
  };

  // End active call (caller cancels, or either user hangs up)
  const endCall = async () => {
    soundEffects.playCallEnded();
    const curCall = activeCallRef.current || activeCall;
    const finalDuration = connectedAtRef.current
      ? Math.max(0, Math.floor((Date.now() - connectedAtRef.current) / 1000))
      : callDurationRef.current || 0;

    if (curCall) {
      isCleaningUpRef.current = true;

      // 1. Update Firestore
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

      // 2. Update RTDB non-blockingly
      try {
        await rtdbUpdate(rtdbRef(rtdb, `calls/${curCall.id}`), {
          status: 'ended',
          duration: finalDuration,
          endedBy: currentUser?.uid || '',
          endedAt: Date.now(),
        });
        await rtdbRemove(rtdbRef(rtdb, `userCalls/${curCall.calleeId}/${curCall.id}`));
      } catch (rtdbErr) {
        console.warn('RTDB end call notice:', rtdbErr);
      }

      // 3. Record call history
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

  // Toggle Speaker / Output Audio
  const toggleSpeaker = () => {
    setIsSpeakerOn((prev) => !prev);
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
        isSpeakerOn,
        toggleSpeaker,
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
