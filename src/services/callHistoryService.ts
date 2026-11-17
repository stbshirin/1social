import { ref, set, onValue } from 'firebase/database';
import { doc, setDoc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
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
  status: 'accepted' | 'rejected' | 'missed' | 'ended' | 'cancelled';
  startedAt?: number | null;
  connectedAt?: number | null;
  endedAt?: number;
  endedBy?: string;
  duration?: number;
  createdAt?: string;
}

// In-memory set to prevent duplicate recordings in the same browser session
const recordedCalls = new Set<string>();

/**
 * Truly non-blocking RTDB wrapper with a 1.2s timeout so RTDB availability
 * never blocks Firestore call history persistence or live subscriptions.
 */
function safeRtdbWrite(operation: () => Promise<any>): void {
  try {
    Promise.race([
      operation(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('RTDB timeout')), 1200)),
    ]).catch(() => {
      // Ignored non-blockingly
    });
  } catch {
    // Ignored non-blockingly
  }
}

/**
 * Atomically records call completion & final duration to Firestore (primary) and RTDB (mirror).
 * Uses callId as deterministic document ID so each call produces exactly ONE shared record
 * with identical startedAt, endedAt, and durationSeconds for both Caller and Receiver.
 */
export async function recordCallHistory(params: RecordCallParams): Promise<void> {
  const { callId, callerId, calleeId } = params;
  if (!callId || !callerId || !calleeId) return;

  // Prevent duplicate writes in the same session for the same callId
  if (recordedCalls.has(callId)) {
    return;
  }
  recordedCalls.add(callId);

  const endedAtTimestamp = typeof params.endedAt === 'number' && params.endedAt > 0
    ? params.endedAt
    : Date.now();

  const effectiveStartedAt = params.startedAt ?? params.connectedAt ?? null;
  let calculatedDuration = 0;

  // Ringing, missed, rejected, cancelled calls are strictly 0 duration (00:00)
  if (params.status === 'rejected' || params.status === 'missed' || params.status === 'cancelled') {
    calculatedDuration = 0;
  } else if (effectiveStartedAt && effectiveStartedAt > 0) {
    // Authoritative calculation: endedAt - startedAt
    calculatedDuration = Math.max(0, Math.floor((endedAtTimestamp - effectiveStartedAt) / 1000));
  } else if (typeof params.duration === 'number' && params.duration > 0) {
    calculatedDuration = Math.floor(params.duration);
  }

  // If the call ended before WebRTC actually connected (no startedAt & 0 duration), treat as missed/cancelled
  let finalStatus = params.status;
  if (finalStatus === 'ended' && !effectiveStartedAt && calculatedDuration === 0) {
    finalStatus = 'missed';
  }

  const normalizedStartedAt =
    finalStatus === 'rejected' || finalStatus === 'missed' || finalStatus === 'cancelled'
      ? null
      : effectiveStartedAt;

  const durationFormatted = formatCallDuration(calculatedDuration);

  const historyItem: CallHistoryItem = {
    id: callId,
    callId,
    callerId: params.callerId,
    callerName: params.callerName,
    callerPhoto: params.callerPhoto || '',
    calleeId: params.calleeId,
    receiverId: params.calleeId,
    calleeName: params.calleeName,
    calleePhoto: params.calleePhoto || '',
    type: params.type,
    callType: params.type,
    status: finalStatus,
    duration: calculatedDuration,
    durationSeconds: calculatedDuration,
    durationFormatted,
    startedAt: normalizedStartedAt,
    connectedAt: normalizedStartedAt,
    endedAt: endedAtTimestamp,
    endedBy: params.endedBy || '',
    createdAt: params.createdAt || new Date(normalizedStartedAt || endedAtTimestamp).toISOString(),
    participants: [params.callerId, params.calleeId],
  };

  // 1. Primary authoritative write to Firestore callHistory/${callId}
  try {
    const firestoreCallRef = doc(db, 'callHistory', callId);
    // Avoid overwriting an already finalized identical call history record from the other peer
    const existingSnap = await getDoc(firestoreCallRef).catch(() => null);
    if (existingSnap && existingSnap.exists()) {
      const existingData = existingSnap.data() as CallHistoryItem;
      const existingDur = existingData.durationSeconds ?? existingData.duration ?? 0;
      const existingEnded = existingData.endedAt;
      // Only update if existing record wasn't finalized yet or has incomplete data
      if (existingEnded && (existingDur > 0 || calculatedDuration === 0)) {
        return;
      }
    }
    await setDoc(firestoreCallRef, historyItem, { merge: true });
  } catch (fsErr) {
    console.warn('Firestore callHistory write notice:', fsErr);
    // Allow retry if write failed
    recordedCalls.delete(callId);
  }

  // 2. Non-blocking mirror write to RTDB (if enabled)
  safeRtdbWrite(() => {
    const rtdbCallHistoryRef = ref(rtdb, `callHistory/${callId}`);
    const callerHistoryRef = ref(rtdb, `userCallHistory/${callerId}/${callId}`);
    const calleeHistoryRef = ref(rtdb, `userCallHistory/${calleeId}/${callId}`);
    return Promise.all([
      set(rtdbCallHistoryRef, historyItem),
      set(callerHistoryRef, historyItem),
      set(calleeHistoryRef, historyItem),
    ]);
  });
}

function normalizeCallHistoryItem(raw: any, docId?: string): CallHistoryItem {
  const durationSeconds =
    typeof raw.durationSeconds === 'number'
      ? raw.durationSeconds
      : typeof raw.duration === 'number'
      ? raw.duration
      : 0;
  const callType = raw.callType || raw.type || 'audio';
  const calleeId = raw.receiverId || raw.calleeId || '';
  const startedAt = raw.startedAt ?? raw.connectedAt ?? null;

  return {
    ...raw,
    id: raw.id || raw.callId || docId || '',
    callId: raw.callId || raw.id || docId || '',
    calleeId,
    receiverId: calleeId,
    type: callType,
    callType,
    duration: durationSeconds,
    durationSeconds,
    durationFormatted: raw.durationFormatted || formatCallDuration(durationSeconds),
    startedAt,
    connectedAt: startedAt,
    participants: Array.isArray(raw.participants)
      ? raw.participants
      : [raw.callerId, calleeId].filter(Boolean),
  };
}

/**
 * Subscribes to real-time call history for the authenticated user.
 * Immediately attaches Firestore listener as primary authoritative source of truth.
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
  const itemMap = new Map<string, CallHistoryItem>();

  const emitSorted = () => {
    if (!isMounted) return;
    const list = Array.from(itemMap.values());
    list.sort((a, b) => {
      const timeA =
        typeof a.endedAt === 'number'
          ? a.endedAt
          : new Date(a.endedAt || a.createdAt || 0).getTime();
      const timeB =
        typeof b.endedAt === 'number'
          ? b.endedAt
          : new Date(b.endedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
    onUpdate(list);
  };

  // 1. Primary Authoritative Firestore Listener (Immediate, non-blocking)
  const q = query(
    collection(db, 'callHistory'),
    where('participants', 'array-contains', userId)
  );

  const unsubFirestore = onSnapshot(
    q,
    (snap) => {
      if (!isMounted) return;
      snap.docs.forEach((d) => {
        const normalized = normalizeCallHistoryItem(d.data(), d.id);
        if (normalized.callId) {
          itemMap.set(normalized.callId, normalized);
        }
      });
      emitSorted();
    },
    (err) => {
      console.warn('Firestore callHistory listener notice:', err?.message || err);
    }
  );

  // 2. Non-blocking RTDB Secondary Listener (for legacy RTDB items if RTDB is enabled)
  let unsubRtdb: (() => void) | null = null;
  try {
    const userHistoryRef = ref(rtdb, `userCallHistory/${userId}`);
    unsubRtdb = onValue(
      userHistoryRef,
      (snapshot) => {
        if (!isMounted) return;
        const val = snapshot.val();
        if (val && typeof val === 'object') {
          Object.entries(val).forEach(([key, raw]) => {
            const normalized = normalizeCallHistoryItem(raw, key);
            if (normalized.callId && !itemMap.has(normalized.callId)) {
              itemMap.set(normalized.callId, normalized);
            }
          });
          emitSorted();
        }
      },
      () => {
        // Silently ignored; Firestore is primary
      }
    );
  } catch {
    // Non-blocking
  }

  return () => {
    isMounted = false;
    unsubFirestore();
    if (unsubRtdb) {
      try {
        unsubRtdb();
      } catch {
        // Ignored
      }
    }
  };
}
