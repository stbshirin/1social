export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  username: string;
  photoURL?: string;
  coverURL?: string;
  bio?: string;
  location?: string;
  website?: string;
  role: 'user' | 'admin';
  adminBadgeVisibility?: 'public' | 'followers' | 'only_me';
  isOnline?: boolean;
  lastSeen?: string | number;
  isSuspended?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorPhotoURL?: string;
  content: string;
  mediaType: 'none' | 'image' | 'video';
  mediaUrl?: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  isEdited?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface Like {
  id: string;
  postId: string;
  userId: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorPhotoURL?: string;
  content: string;
  parentCommentId?: string;
  createdAt: string;
}

export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

export interface ParticipantDetail {
  displayName: string;
  username: string;
  photoURL?: string;
}

export interface Conversation {
  id: string;
  participants: string[];
  participantDetails: Record<string, ParticipantDetail>;
  isGroup: boolean;
  groupName?: string;
  groupPhoto?: string;
  lastMessage?: string;
  lastMessageSenderId?: string;
  lastMessageAt?: string;
  updatedAt: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string;
  text: string;
  mediaType?: 'none' | 'image' | 'video' | 'audio' | 'file';
  mediaUrl?: string;
  seenBy: string[];
  createdAt: string;
}

export interface CallSession {
  id: string;
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  calleeId: string;
  calleeName: string;
  calleePhoto?: string;
  type: 'audio' | 'video';
  status: 'offering' | 'ringing' | 'accepted' | 'rejected' | 'ended' | 'missed';
  offer?: any;
  answer?: any;
  createdAt: string;
  connectedAt?: number;
  endedAt?: string;
  duration?: number;
  durationFormatted?: string;
}

export interface CallHistoryItem {
  id: string;
  callId: string;
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  calleeId: string;
  calleeName: string;
  calleePhoto?: string;
  type: 'audio' | 'video';
  status: 'accepted' | 'rejected' | 'missed' | 'ended' | 'outgoing' | 'incoming';
  duration: number; // In seconds
  durationFormatted: string; // e.g. "02:15", "00:00"
  connectedAt?: number | null;
  endedAt: number | string;
  createdAt: string;
  participants: string[];
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string;
  type: 'like' | 'comment' | 'follow' | 'call' | 'message' | 'system';
  title: string;
  content: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export interface ReportItem {
  id: string;
  reporterId: string;
  targetType: 'post' | 'user' | 'comment';
  targetId: string;
  reason: string;
  details?: string;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
}
