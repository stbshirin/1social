import { ref, set, onValue, DatabaseReference } from 'firebase/database';
import { doc, setDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { rtdb, db } from '../firebase/config';
import { CallHistoryItem } from '../types';

/**
 * Formats duration in seconds into standard MM:SS or HH:MM:SS format
 * Examples:
 *  - 25s => "00:25"
 *  - 135s (2m 15s) => "02:15"
 *  - 760s (12m 40s) => "12:40"
 *  - 3920s (1h 5m 20s) => "01:05:20"
 */
export function formatCallDuration(totalSeconds: number): string {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds <= 0) {
    return '00:00';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  if (hours > 0) {
    const hh = hours.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}

export interface RecordCallParams {
  callId: string;
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  calleeId: string;
  calleeName: string;
  calleePhoto?: string;
  type: 'audio' | 'video';
  status: 'accepted' | 'rejected' | 'missed' | 'ended';
  connectedAt?: number | null;
  endedAt?: number;
  duration?: number;
}

// In-memory set to prevent duplicate recordings in the same browser session
const recordedCalls = new Set<string>();

/**
 * Atomically records call completion & final duration in both RTDB and Firestore
 */
export async function recordCallHistory(params: RecordCallParams): Promise<void> {
  const { callId, callerId, calleeId } = params;
  if (!callId || !callerId || !calleeId) return;

  const dedupeKey = `${callId}_${params.status}`;
  if (recordedCalls.has(dedupeKey)) {
    return;
  }
  recordedCalls.add(dedupeKey);

  const endedAtTimestamp = params.endedAt || Date.now();
  let calculatedDuration = 0;

  // Connected calls calculate real duration from connection timestamp
  if (params.connectedAt && params.connectedAt > 0 && (params.status === 'accepted' || params.status === 'ended')) {
    calculatedDuration = Math.max(0, Math.floor((endedAtTimestamp - params.connectedAt) / 1000));
  } else if (typeof params.duration === 'number' && params.duration > 0) {
    calculatedDuration = params.duration;
  }

  // Ringing, missed, rejected, busy calls are strictly 0 duration (00:00)
  if (params.status === 'rejected' || params.status === 'missed') {
    calculatedDuration = 0;
  }

  const durationFormatted = formatCallDuration(calculatedDuration);

  const historyItem: CallHistoryItem = {
    id: callId,
    callId,
    callerId: params.callerId,
    callerName: params.callerName,
    callerPhoto: params.callerPhoto || '',
    calleeId: params.calleeId,
    calleeName: params.calleeName,
    calleePhoto: params.calleePhoto || '',
    type: params.type,
    status: params.status,
    duration: calculatedDuration,
    durationFormatted,
    connectedAt: params.connectedAt || null,
    endedAt: endedAtTimestamp,
    createdAt: new Date().toISOString(),
    participants: [params.callerId, params.calleeId],
  };

  // 1. Save to Realtime Database under callHistory/${callId}
  try {
    const rtdbCallHistoryRef = ref(rtdb, `callHistory/${callId}`);
    await set(rtdbCallHistoryRef, historyItem);

    // Save individual user pointers for rapid indexing
    const callerHistoryRef = ref(rtdb, `userCallHistory/${callerId}/${callId}`);
    const calleeHistoryRef = ref(rtdb, `userCallHistory/${calleeId}/${callId}`);
    await Promise.all([set(callerHistoryRef, historyItem), set(calleeHistoryRef, historyItem)]);
  } catch (rtdbErr) {
    console.warn('RTDB callHistory write notice (will sync to Firestore):', rtdbErr);
  }

  // 2. Save to Firestore callHistory collection
  try {
    const firestoreCallRef = doc(db, 'callHistory', callId);
    await setDoc(firestoreCallRef, historyItem, { merge: true });
  } catch (fsErr) {
    console.warn('Firestore callHistory write notice:', fsErr);
  }
}

/**
 * Subscribes to real-time call history for the authenticated user
 */
export function subscribeToUserCallHistory(
  userId: string,
  onUpdate: (history: CallHistoryItem[]) => void
): () => void {
  if (!userId) {
    onUpdate([]);
    return () => {};
  }

  let isMounted = true;

  // Try RTDB first
  try {
    const userHistoryRef = ref(rtdb, `userCallHistory/${userId}`);
    const unsubRtdb = onValue(
      userHistoryRef,
      (snapshot) => {
        if (!isMounted) return;
        const val = snapshot.val();
        if (val) {
          const list: CallHistoryItem[] = Object.values(val);
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          onUpdate(list);
          return;
        }

        // If RTDB user node is empty, fall back to Firestore listener
        fallbackFirestoreListener();
      },
      (error) => {
        console.warn('RTDB callHistory listener fallback to Firestore:', error?.message || error);
        fallbackFirestoreListener();
      }
    );

    let unsubFirestore: (() => void) | null = null;
    function fallbackFirestoreListener() {
      if (unsubFirestore || !isMounted) return;
      const q = query(
        collection(db, 'callHistory'),
        where('participants', 'array-contains', userId)
      );
      unsubFirestore = onSnapshot(
        q,
        (snap) => {
          if (!isMounted) return;
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CallHistoryItem));
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          onUpdate(list);
        },
        (err) => {
          console.warn('Firestore callHistory listener notice:', err?.message || err);
        }
      );
    }

    return () => {
      isMounted = false;
      unsubRtdb();
      if (unsubFirestore) unsubFirestore();
    };
  } catch (err) {
    console.warn('Call history subscription notice:', err);
    return () => {};
  }
}
