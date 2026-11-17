export interface CallParticipantFallback {
  displayName: string;
  username: string;
  photoURL: string;
}

export interface CallIdentityResolution {
  callerId: string;
  receiverId: string;
  currentUserId: string;
  isCurrentUserCaller: boolean;
  isCurrentUserReceiver: boolean;
  localUserId: string;
  remoteUserId: string;
  localFallback: CallParticipantFallback;
  remoteFallback: CallParticipantFallback;
}

export interface CallLike {
  id?: string;
  callerId?: string;
  callerName?: string;
  callerUsername?: string;
  callerPhoto?: string;
  calleeId?: string;
  receiverId?: string;
  calleeName?: string;
  calleeUsername?: string;
  calleePhoto?: string;
}

export function getDefaultAvatar(uid?: string | null): string {
  const safeSeed = encodeURIComponent((uid || 'user').trim() || 'user');
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${safeSeed}`;
}

export function resolveSafePhotoUrl(url?: string | null, uid?: string | null): string {
  if (typeof url === 'string' && url.trim().length > 0) {
    return url.trim();
  }
  return getDefaultAvatar(uid);
}

/**
 * Deterministically resolves Caller vs Receiver (Local vs Remote) identities for any call session.
 * Guarantees that:
 * - If currentUserId === callerId -> Local = Caller, Remote = Receiver
 * - If currentUserId === receiverId -> Local = Receiver, Remote = Caller
 * - Caller and Receiver NEVER share each other's photoURL or displayName fallback.
 */
export function resolveCallParticipantIdentities(
  call: CallLike | null | undefined,
  currentUserId?: string | null
): CallIdentityResolution {
  const cleanCurrentUid = (currentUserId || '').trim();
  const callerId = (call?.callerId || '').trim();
  const receiverId = (call?.receiverId || call?.calleeId || '').trim();

  const callerFallback: CallParticipantFallback = {
    displayName: call?.callerName?.trim() || '1 social Member',
    username: call?.callerUsername?.trim() || 'user',
    photoURL: resolveSafePhotoUrl(call?.callerPhoto, callerId),
  };

  const receiverFallback: CallParticipantFallback = {
    displayName: call?.calleeName?.trim() || '1 social Member',
    username: call?.calleeUsername?.trim() || 'user',
    photoURL: resolveSafePhotoUrl(call?.calleePhoto, receiverId),
  };

  const isCurrentUserCaller = Boolean(cleanCurrentUid && callerId && cleanCurrentUid === callerId);
  const isCurrentUserReceiver = Boolean(
    cleanCurrentUid && receiverId && cleanCurrentUid === receiverId && !isCurrentUserCaller
  );

  if (isCurrentUserCaller) {
    return {
      callerId,
      receiverId,
      currentUserId: cleanCurrentUid,
      isCurrentUserCaller: true,
      isCurrentUserReceiver: false,
      localUserId: callerId,
      remoteUserId: receiverId,
      localFallback: callerFallback,
      remoteFallback: receiverFallback,
    };
  }

  return {
    callerId,
    receiverId,
    currentUserId: cleanCurrentUid,
    isCurrentUserCaller: false,
    isCurrentUserReceiver: isCurrentUserReceiver || Boolean(cleanCurrentUid),
    localUserId: receiverId || cleanCurrentUid,
    remoteUserId: callerId,
    localFallback: receiverFallback,
    remoteFallback: callerFallback,
  };
}
