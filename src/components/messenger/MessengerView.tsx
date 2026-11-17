import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Phone,
  Video,
  Send,
  Image,
  Mic,
  MicOff,
  MoreVertical,
  Check,
  CheckCheck,
  Plus,
  Users,
  X,
  File,
  ArrowLeft,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  MessageSquare,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  orderBy,
  getDocs,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCall } from '../../context/CallContext';
import { soundEffects } from '../../services/soundEffects';
import { Conversation, Message, UserProfile, CallHistoryItem } from '../../types';
import { handleFirestoreError, OperationType } from '../../firebase/errorHandler';
import { getSocialUsersCollection } from '../../services/userService';
import { uploadChatAttachment } from '../../services/storageService';
import { usePresence } from '../../services/presenceService';
import { AdminBadge } from '../common/AdminBadge';
import { VerifiedBadge } from '../common/VerifiedBadge';
import { subscribeToUserCallHistory, formatCallDuration } from '../../services/callHistoryService';
import { useLiveUserProfile, getDefaultAvatar } from '../../hooks/useLiveUserProfile';

interface MessengerViewProps {
  initialChatUser?: UserProfile | null;
  onClearInitialChatUser?: () => void;
}

export const MessengerView: React.FC<MessengerViewProps> = ({
  initialChatUser,
  onClearInitialChatUser,
}) => {
  const { currentUser, userProfile } = useAuth();
  const { initiateCall } = useCall();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [mergedConvIdsByOtherUid, setMergedConvIdsByOtherUid] = useState<Record<string, string[]>>({});
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const creatingChatRef = useRef(false);

  // Sidebar Tabs: Chats vs Calls
  const [activeSidebarTab, setActiveSidebarTab] = useState<'chats' | 'calls'>('chats');
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);
  const [callSearchQuery, setCallSearchQuery] = useState('');

  // Subscribe to Call History for Current User
  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsub = subscribeToUserCallHistory(currentUser.uid, (history) => {
      setCallHistory(history);
    });
    return () => unsub();
  }, [currentUser]);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Media attachment state
  const [attachmentData, setAttachmentData] = useState<{ url: string; type: 'image' | 'video' | 'file' | 'audio' } | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // New Chat Modal state
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Helper: Resolve timestamp in ms for sorting conversations
  const getConvTimestamp = (c: Conversation): number => {
    const raw = c.lastMessageAt || c.updatedAt || c.createdAt;
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return isNaN(t) ? 0 : t;
  };

  // Helper: Deduplicate 1-on-1 conversations by otherUserId (never by displayName)
  // while keeping group chats distinct and mapping all duplicate conversation IDs for message merging.
  const deduplicateConversations = (
    rawList: Conversation[],
    uid: string
  ): { deduplicated: Conversation[]; mergedIdsMap: Record<string, string[]> } => {
    const directGroups = new Map<string, Conversation[]>();
    const groupChats: Conversation[] = [];

    rawList.forEach((conv) => {
      if (conv.isGroup) {
        groupChats.push(conv);
        return;
      }
      const otherUid =
        conv.participants?.find((p) => p !== uid) ||
        (conv.participants?.includes(uid) && conv.participants.length <= 2 ? uid : '');

      if (!otherUid) {
        groupChats.push(conv);
        return;
      }

      const existingGroup = directGroups.get(otherUid) || [];
      existingGroup.push(conv);
      directGroups.set(otherUid, existingGroup);
    });

    const mergedIdsMap: Record<string, string[]> = {};
    const mergedDirects: Conversation[] = [];

    directGroups.forEach((group, otherUid) => {
      mergedIdsMap[otherUid] = group.map((c) => c.id);

      if (group.length === 1) {
        mergedDirects.push(group[0]);
        return;
      }

      // Rank duplicates: prefer real messages over placeholder 'Conversation started', then latest activity, then deterministic dm_ id
      const sortedGroup = [...group].sort((a, b) => {
        const aHasRealMsg = Boolean(a.lastMessage && a.lastMessage !== 'Conversation started');
        const bHasRealMsg = Boolean(b.lastMessage && b.lastMessage !== 'Conversation started');
        if (aHasRealMsg !== bHasRealMsg) return bHasRealMsg ? 1 : -1;

        const timeDiff = getConvTimestamp(b) - getConvTimestamp(a);
        if (timeDiff !== 0) return timeDiff;

        const aIsDet = a.id.startsWith('dm_');
        const bIsDet = b.id.startsWith('dm_');
        if (aIsDet !== bIsDet) return bIsDet ? 1 : -1;

        return 0;
      });

      const primary = sortedGroup[0];
      // Merge participantDetails across duplicates so profile info stays complete
      const mergedParticipantDetails = { ...(primary.participantDetails || {}) };
      for (let i = sortedGroup.length - 1; i >= 0; i--) {
        const details = sortedGroup[i].participantDetails || {};
        Object.entries(details).forEach(([pUid, info]) => {
          if (info) {
            mergedParticipantDetails[pUid] = {
              ...(mergedParticipantDetails[pUid] || {}),
              ...info,
            };
          }
        });
      }

      // Find the freshest message metadata across all duplicate records
      const freshestByTime = [...group].sort((a, b) => getConvTimestamp(b) - getConvTimestamp(a))[0];

      mergedDirects.push({
        ...primary,
        participantDetails: mergedParticipantDetails,
        lastMessage:
          freshestByTime.lastMessage && freshestByTime.lastMessage !== 'Conversation started'
            ? freshestByTime.lastMessage
            : primary.lastMessage,
        lastMessageSenderId: freshestByTime.lastMessageSenderId || primary.lastMessageSenderId,
        lastMessageAt: freshestByTime.lastMessageAt || primary.lastMessageAt,
        updatedAt: freshestByTime.updatedAt || primary.updatedAt,
      });
    });

    const deduplicated = [...mergedDirects, ...groupChats].sort(
      (a, b) => getConvTimestamp(b) - getConvTimestamp(a)
    );

    return { deduplicated, mergedIdsMap };
  };

  // Load conversations where current user is a participant (and deduplicate by otherUserId)
  useEffect(() => {
    if (!currentUser) {
      setConversations([]);
      setMergedConvIdsByOtherUid({});
      setConversationsLoaded(false);
      return;
    }

    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', currentUser.uid)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const rawList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Conversation));
        const { deduplicated, mergedIdsMap } = deduplicateConversations(rawList, currentUser.uid);
        setConversations(deduplicated);
        setMergedConvIdsByOtherUid(mergedIdsMap);
        setConversationsLoaded(true);

        // Keep selectedConversation synchronized with canonical deduplicated entry
        setSelectedConversation((prev) => {
          if (!prev) return null;
          if (!prev.isGroup) {
            const prevOther = prev.participants.find((p) => p !== currentUser.uid);
            const matchByOther = prevOther
              ? deduplicated.find((c) => !c.isGroup && c.participants.includes(prevOther))
              : undefined;
            if (matchByOther) return matchByOther;
          }
          const matchById = deduplicated.find((c) => c.id === prev.id);
          return matchById || prev;
        });
      },
      (error) => {
        console.warn('Conversations listener notice:', error?.message || error);
        setConversationsLoaded(true);
      }
    );

    return () => unsub();
  }, [currentUser]);

  // Load all socialApp users for starting a new chat (deduplicated by uid)
  useEffect(() => {
    if (!currentUser) return;
    const fetchUsers = async () => {
      try {
        const snap = await getDocs(getSocialUsersCollection());
        const byUid = new Map<string, UserProfile>();
        snap.docs.forEach((d) => {
          const data = { id: d.id, ...d.data() } as UserProfile;
          const uid = data.uid || d.id;
          if (uid && uid !== currentUser.uid && !byUid.has(uid)) {
            byUid.set(uid, { ...data, uid });
          }
        });
        setAllUsers(Array.from(byUid.values()));
      } catch (err) {
        console.warn('Users fetch notice:', err);
      }
    };
    fetchUsers();
  }, [currentUser]);

  // Find an existing 1-on-1 conversation or create a deterministic one (dm_<uid1>_<uid2>)
  const findOrCreateDirectConversation = async (targetUser: UserProfile): Promise<Conversation | null> => {
    if (!currentUser || !userProfile) return null;

    // 1. Check already loaded deduplicated state first
    const localExisting = conversations.find(
      (c) => !c.isGroup && c.participants.includes(targetUser.uid)
    );
    if (localExisting) {
      return localExisting;
    }

    if (creatingChatRef.current) return null;
    creatingChatRef.current = true;

    try {
      // 2. Live Firestore check to prevent race conditions across clicks or devices
      const existingSnap = await getDocs(
        query(collection(db, 'conversations'), where('participants', 'array-contains', currentUser.uid))
      );
      const allDocs = existingSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Conversation));
      const { deduplicated } = deduplicateConversations(allDocs, currentUser.uid);
      const remoteExisting = deduplicated.find(
        (c) => !c.isGroup && c.participants.includes(targetUser.uid)
      );
      if (remoteExisting) {
        return remoteExisting;
      }

      // 3. No conversation exists — create one with deterministic pair ID & pairKey
      const sortedPair = [currentUser.uid, targetUser.uid].sort();
      const pairKey = sortedPair.join('_');
      const convId = `dm_${pairKey}`;
      const convRef = doc(db, 'conversations', convId);

      const deterministicSnap = await getDoc(convRef).catch(() => null);
      if (deterministicSnap && deterministicSnap.exists()) {
        return { id: deterministicSnap.id, ...deterministicSnap.data() } as Conversation;
      }

      const nowIso = new Date().toISOString();
      const newConv: Conversation = {
        id: convId,
        participants: sortedPair,
        pairKey,
        participantDetails: {
          [currentUser.uid]: {
            displayName: userProfile.displayName,
            username: userProfile.username,
            photoURL: userProfile.photoURL,
          },
          [targetUser.uid]: {
            displayName: targetUser.displayName,
            username: targetUser.username,
            photoURL: targetUser.photoURL,
          },
        },
        isGroup: false,
        lastMessage: 'Conversation started',
        lastMessageSenderId: currentUser.uid,
        lastMessageAt: nowIso,
        updatedAt: nowIso,
        createdAt: nowIso,
      };

      await setDoc(convRef, newConv, { merge: true });
      return newConv;
    } finally {
      creatingChatRef.current = false;
    }
  };

  // Handle initialChatUser passed from outside — WAIT until conversationsLoaded so we never create a duplicate
  useEffect(() => {
    if (!initialChatUser || !currentUser || !userProfile || !conversationsLoaded) return;

    let cancelled = false;
    const startDirectChat = async () => {
      try {
        const conv = await findOrCreateDirectConversation(initialChatUser);
        if (!cancelled && conv) {
          setSelectedConversation(conv);
        }
      } catch (err) {
        console.warn('Error opening direct chat:', err);
      } finally {
        if (!cancelled) {
          onClearInitialChatUser?.();
        }
      }
    };

    startDirectChat();
    return () => {
      cancelled = true;
    };
  }, [initialChatUser, conversationsLoaded, currentUser, userProfile]);

  // Listen to messages of selected conversation (merging all consolidated conversation IDs for the same user pair)
  const selectedOtherUid =
    selectedConversation && !selectedConversation.isGroup && currentUser
      ? selectedConversation.participants.find((p) => p !== currentUser.uid) || ''
      : '';
  const activeConversationIdsKey =
    selectedConversation && !selectedConversation.isGroup && selectedOtherUid && mergedConvIdsByOtherUid[selectedOtherUid]?.length
      ? mergedConvIdsByOtherUid[selectedOtherUid].join(',')
      : selectedConversation?.id || '';

  useEffect(() => {
    if (!selectedConversation || !currentUser || !activeConversationIdsKey) {
      setMessages([]);
      return;
    }

    const convIds = activeConversationIdsKey.split(',').filter(Boolean);
    const messagesByConvId = new Map<string, Message[]>();
    const initialLoadMap = new Map<string, boolean>();
    const unsubs: (() => void)[] = [];

    const emitMergedMessages = () => {
      const uniqueMsgs = new Map<string, Message>();
      messagesByConvId.forEach((list) => {
        list.forEach((m) => {
          const uniqueKey = `${m.conversationId}_${m.id}`;
          uniqueMsgs.set(uniqueKey, m);
        });
      });
      const merged = Array.from(uniqueMsgs.values()).sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tA - tB;
      });
      setMessages(merged);
    };

    convIds.forEach((convId) => {
      const q = query(
        collection(db, 'conversations', convId, 'messages'),
        orderBy('createdAt', 'asc')
      );

      const unsub = onSnapshot(
        q,
        (snapshot) => {
          const list = snapshot.docs.map(
            (d) => ({ id: d.id, conversationId: convId, ...d.data() } as Message)
          );
          messagesByConvId.set(convId, list);
          emitMergedMessages();

          // Only chime on genuinely newly arriving messages after initial hydration
          if (initialLoadMap.get(convId)) {
            if (
              snapshot
                .docChanges()
                .some((ch) => ch.type === 'added' && ch.doc.data().senderId !== currentUser.uid)
            ) {
              soundEffects.playMessageNotification();
            }
          } else {
            initialLoadMap.set(convId, true);
          }

          // Mark seenBy in the exact source conversation subcollection
          snapshot.docs.forEach(async (docSnap) => {
            const msg = docSnap.data() as Message;
            if (!msg.seenBy?.includes(currentUser.uid)) {
              try {
                await updateDoc(docSnap.ref, {
                  seenBy: [...(msg.seenBy || []), currentUser.uid],
                });
              } catch {
                // Non-blocking
              }
            }
          });
        },
        (error) => {
          console.warn('Messages listener notice:', error?.message || error);
        }
      );

      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [selectedConversation?.id, activeConversationIdsKey, currentUser]);

  // Send Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedConversation || !currentUser || !userProfile) return;
    if (!messageText.trim() && !attachmentData) return;

    const textToSend = messageText.trim();
    const mediaType = attachmentData ? attachmentData.type : 'none';
    const mediaUrl = attachmentData ? attachmentData.url : '';

    setMessageText('');
    setAttachmentData(null);

    try {
      const msgData = {
        conversationId: selectedConversation.id,
        senderId: currentUser.uid,
        senderName: userProfile.displayName,
        senderPhoto: userProfile.photoURL || '',
        text: textToSend,
        mediaType,
        mediaUrl,
        seenBy: [currentUser.uid],
        createdAt: new Date().toISOString(),
      };

      await addDoc(
        collection(db, 'conversations', selectedConversation.id, 'messages'),
        msgData
      );

      // Update conversation's last message
      const convRef = doc(db, 'conversations', selectedConversation.id);
      await updateDoc(convRef, {
        lastMessage: mediaType !== 'none' ? `Sent an ${mediaType}` : textToSend,
        lastMessageSenderId: currentUser.uid,
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `conversations/${selectedConversation.id}/messages`);
    }
  };

  // Voice Note Recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        if (!currentUser) return;

        setUploadingAttachment(true);
        setAttachmentProgress(1);
        try {
          const res = await uploadChatAttachment(
            currentUser.uid,
            audioBlob,
            `voice_${Date.now()}.webm`,
            (p) => setAttachmentProgress(p)
          );
          setAttachmentData({
            url: res.url,
            type: 'audio',
          });
        } catch (err: any) {
          console.error('Voice note upload error:', err);
          alert(err.message || 'Voice note upload failed.');
        } finally {
          setUploadingAttachment(false);
          setAttachmentProgress(null);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.warn('Microphone permission denied for voice message:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // File / Media attachment
  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setUploadingAttachment(true);
    setAttachmentProgress(1);
    try {
      const res = await uploadChatAttachment(
        currentUser.uid,
        file,
        file.name,
        (p) => setAttachmentProgress(p)
      );
      setAttachmentData({
        url: res.url,
        type: res.type,
      });
    } catch (err: any) {
      console.error('Attachment upload error:', err);
      alert(err.message || 'Attachment upload failed.');
    } finally {
      setUploadingAttachment(false);
      setAttachmentProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Delete message (supports merged historical conversations cleanly)
  const handleDeleteMessage = async (msg: Message) => {
    if (!selectedConversation) return;
    const targetConvId = msg.conversationId || selectedConversation.id;
    try {
      await deleteDoc(doc(db, 'conversations', targetConvId, 'messages', msg.id));
    } catch (e) {
      console.warn('Error deleting message:', e);
    }
  };

  // Start new 1-on-1 or group chat
  const handleCreateChat = async (targetUser?: UserProfile) => {
    if (!currentUser || !userProfile) return;

    if (isCreatingGroup) {
      if (!groupName.trim() || selectedGroupMembers.length === 0) {
        alert('Please provide a group name and select at least one member.');
        return;
      }

      const allParticipants = [currentUser.uid, ...selectedGroupMembers];
      const details: Record<string, any> = {
        [currentUser.uid]: {
          displayName: userProfile.displayName,
          username: userProfile.username,
          photoURL: userProfile.photoURL,
        },
      };

      selectedGroupMembers.forEach((uid) => {
        const u = allUsers.find((user) => user.uid === uid);
        if (u) {
          details[uid] = {
            displayName: u.displayName,
            username: u.username,
            photoURL: u.photoURL,
          };
        }
      });

      const convRef = doc(collection(db, 'conversations'));
      const newGroup: Conversation = {
        id: convRef.id,
        participants: allParticipants,
        participantDetails: details,
        isGroup: true,
        groupName: groupName.trim(),
        groupPhoto: `https://api.dicebear.com/7.x/identicon/svg?seed=${convRef.id}`,
        lastMessage: 'Group created',
        lastMessageSenderId: currentUser.uid,
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      await setDoc(convRef, newGroup);
      setSelectedConversation(newGroup);
      setShowNewChatModal(false);
      setIsCreatingGroup(false);
      setGroupName('');
      setSelectedGroupMembers([]);
    } else if (targetUser) {
      try {
        const conv = await findOrCreateDirectConversation(targetUser);
        if (conv) {
          setSelectedConversation(conv);
        }
      } catch (err) {
        console.warn('Error starting chat:', err);
      }
      setShowNewChatModal(false);
    }
  };

  // Get recipient profile for current conversation
  const getOtherParticipant = (conv: Conversation): UserProfile | null => {
    if (conv.isGroup || !currentUser) return null;
    const otherUid = conv.participants.find((p) => p !== currentUser.uid);
    if (!otherUid) return null;

    const detail = conv.participantDetails?.[otherUid];
    return {
      id: otherUid,
      uid: otherUid,
      displayName: detail?.displayName || 'User',
      username: detail?.username || 'user',
      photoURL: detail?.photoURL,
      email: '',
      role: 'user',
    };
  };

  const otherParticipant = selectedConversation ? getOtherParticipant(selectedConversation) : null;

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const other = getOtherParticipant(c);
    const title = c.isGroup ? c.groupName : other?.displayName;
    return title?.toLowerCase().includes(q) || c.lastMessage?.toLowerCase().includes(q);
  });

  const filteredCallHistory = callHistory.filter((call) => {
    if (!callSearchQuery.trim()) return true;
    const q = callSearchQuery.toLowerCase();
    const callTypeLabel = call.callType || call.type || '';
    return (
      call.callerName?.toLowerCase().includes(q) ||
      call.calleeName?.toLowerCase().includes(q) ||
      call.durationFormatted?.toLowerCase().includes(q) ||
      callTypeLabel.toLowerCase().includes(q) ||
      call.status?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full h-[calc(100vh-8rem)] max-w-6xl mx-auto my-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm flex flex-col md:flex-row">
      {/* Left Conversations & Calls Sidebar */}
      <div
        className={`w-full md:w-80 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-900/50 ${
          selectedConversation ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Header with Title and Tabs */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              {activeSidebarTab === 'chats' ? 'Messages' : 'Call History'}
            </h2>
            {activeSidebarTab === 'chats' && (
              <button
                onClick={() => setShowNewChatModal(true)}
                className="p-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-transform active:scale-95 cursor-pointer"
                title="Start New Chat"
              >
                <Plus size={16} />
              </button>
            )}
          </div>

          {/* Segmented Pill Tabs */}
          <div className="grid grid-cols-2 p-1 bg-slate-200/60 dark:bg-slate-800 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setActiveSidebarTab('chats')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeSidebarTab === 'chats'
                  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MessageSquare size={14} />
              <span>Chats</span>
              {conversations.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                  {conversations.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveSidebarTab('calls')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeSidebarTab === 'calls'
                  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Phone size={14} />
              <span>Calls</span>
              {callHistory.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                  {callHistory.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={activeSidebarTab === 'chats' ? 'Search conversations...' : 'Search call history...'}
              value={activeSidebarTab === 'chats' ? searchQuery : callSearchQuery}
              onChange={(e) =>
                activeSidebarTab === 'chats'
                  ? setSearchQuery(e.target.value)
                  : setCallSearchQuery(e.target.value)
              }
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
            />
          </div>
        </div>

        {/* List: Either Chats or Calls */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
          {activeSidebarTab === 'chats' ? (
            filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                <p>No conversations found.</p>
                <button
                  onClick={() => setShowNewChatModal(true)}
                  className="mt-3 text-indigo-600 dark:text-indigo-400 font-semibold underline cursor-pointer"
                >
                  Start a conversation
                </button>
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <MessengerConversationItem
                  key={conv.id}
                  conv={conv}
                  isSelected={selectedConversation?.id === conv.id}
                  onSelect={() => setSelectedConversation(conv)}
                  other={getOtherParticipant(conv)}
                />
              ))
            )
          ) : filteredCallHistory.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-400">
                <Phone size={20} />
              </div>
              <p className="font-semibold text-slate-600 dark:text-slate-300">No Call History</p>
              <p className="mt-1 text-slate-400 text-[11px]">
                Audio and video calls with friends will automatically appear here with their duration.
              </p>
            </div>
          ) : (
            filteredCallHistory.map((call) => (
              <MessengerCallItem
                key={call.id || call.callId}
                item={call}
                currentUserId={currentUser?.uid || ''}
                onCallBack={(target, type) => initiateCall(target, type)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right Chat Panel */}
      <div
        className={`flex-1 flex flex-col bg-white dark:bg-slate-900 ${
          !selectedConversation ? 'hidden md:flex items-center justify-center' : 'flex'
        }`}
      >
        {selectedConversation ? (
          <>
            {/* Chat Top Header with real-time presence & AdminBadge */}
            <MessengerChatHeader
              selectedConversation={selectedConversation}
              otherParticipant={otherParticipant}
              onBack={() => setSelectedConversation(null)}
              onInitiateCall={(target, type) => initiateCall(target, type)}
            />

            {/* Chat Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/30 dark:bg-slate-950/20">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 text-xs">
                  <p>Say hello! Start the conversation.</p>
                </div>
              ) : (
                messages.map((m) => {
                  const isMine = m.senderId === currentUser?.uid;
                  return (
                    <div
                      key={`${m.conversationId || selectedConversation.id}_${m.id}`}
                      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} group`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm shadow-sm relative ${
                          isMine
                            ? 'bg-indigo-600 text-white rounded-br-none'
                            : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-bl-none'
                        }`}
                      >
                        {/* Text */}
                        {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}

                        {/* Media: Image */}
                        {m.mediaType === 'image' && m.mediaUrl && (
                          <img
                            src={m.mediaUrl}
                            alt="Attachment"
                            className="mt-2 rounded-xl max-h-60 object-contain"
                          />
                        )}

                        {/* Media: Video */}
                        {m.mediaType === 'video' && m.mediaUrl && (
                          <video
                            src={m.mediaUrl}
                            controls
                            className="mt-2 rounded-xl max-h-60 object-contain"
                          />
                        )}

                        {/* Media: Audio Voice Note */}
                        {m.mediaType === 'audio' && m.mediaUrl && (
                          <div className="mt-2 flex items-center gap-2">
                            <audio src={m.mediaUrl} controls className="h-9 w-60" />
                          </div>
                        )}

                        {/* Delete button for author on hover */}
                        {isMine && (
                          <button
                            onClick={() => handleDeleteMessage(m)}
                            className="absolute -left-6 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-1"
                            title="Delete message"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Timestamp & Seen checkmarks */}
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400 px-1">
                        <span>
                          {m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                        {isMine && (
                          <span>
                            {m.seenBy && m.seenBy.length > 1 ? (
                              <CheckCheck size={13} className="text-indigo-400 inline" />
                            ) : (
                              <Check size={13} className="inline" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Uploading Attachment Indicator */}
            {uploadingAttachment && (
              <div className="p-2.5 bg-indigo-50 dark:bg-slate-800 border-t border-indigo-100 dark:border-slate-700 flex items-center justify-between text-xs text-indigo-600 dark:text-indigo-400">
                <span className="font-medium animate-pulse">Uploading attachment to Firebase Storage...</span>
                <span className="font-bold">{attachmentProgress || 0}%</span>
              </div>
            )}

            {/* Media Attachment Preview if selected */}
            {attachmentData && (
              <div className="p-3 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                  Attached {attachmentData.type} ready to send
                </span>
                <button
                  onClick={() => setAttachmentData(null)}
                  className="text-xs text-rose-500 hover:underline cursor-pointer"
                >
                  Remove
                </button>
              </div>
            )}

            {/* Chat Input Bar */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-white dark:bg-slate-900"
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 transition-colors cursor-pointer"
                title="Attach photo/video/file"
              >
                <Image size={20} />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                className="hidden"
                onChange={handleAttachmentUpload}
              />

              {/* Voice Note Record Toggle Button */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                className={`p-2 rounded-full transition-colors cursor-pointer ${
                  isRecording
                    ? 'bg-rose-600 text-white animate-pulse'
                    : 'text-slate-500 hover:text-indigo-600 dark:text-slate-400'
                }`}
                title={isRecording ? 'Stop Recording' : 'Record Voice Note'}
              >
                {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              <input
                type="text"
                placeholder={isRecording ? 'Recording voice note...' : 'Type a message...'}
                value={messageText}
                disabled={isRecording}
                onChange={(e) => setMessageText(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <button
                type="submit"
                disabled={!messageText.trim() && !attachmentData}
                className="p-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white shadow-md transition-transform active:scale-95 cursor-pointer"
              >
                <Send size={16} />
              </button>
            </form>
          </>
        ) : (
          <div className="text-center p-8 text-slate-400">
            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
              <Phone size={28} className="text-indigo-500" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Select a Conversation</h3>
            <p className="text-xs text-slate-400">
              Pick a chat or start a real-time WebRTC audio/video call.
            </p>
          </div>
        )}
      </div>

      {/* Start New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isCreatingGroup ? 'Create Group Chat' : 'Start a Conversation'}
              </h3>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Toggle 1-on-1 vs Group */}
            <div className="flex gap-2 mb-4 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setIsCreatingGroup(false)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  !isCreatingGroup
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-400'
                }`}
              >
                Direct Message
              </button>
              <button
                type="button"
                onClick={() => setIsCreatingGroup(true)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  isCreatingGroup
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-400'
                }`}
              >
                New Group
              </button>
            </div>

            {isCreatingGroup && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Group Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Engineering Team"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
            )}

            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {allUsers.map((u) => {
                const isSelected = selectedGroupMembers.includes(u.uid);
                return (
                  <div
                    key={u.uid}
                    onClick={() => {
                      if (isCreatingGroup) {
                        setSelectedGroupMembers((prev) =>
                          isSelected ? prev.filter((id) => id !== u.uid) : [...prev, u.uid]
                        );
                      } else {
                        handleCreateChat(u);
                      }
                    }}
                    className="p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`}
                        alt={u.displayName}
                        className="w-9 h-9 rounded-full object-cover"
                      />
                      <div>
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-bold text-slate-900 dark:text-white">{u.displayName}</p>
                          <VerifiedBadge user={u} size="xs" />
                        </div>
                        <p className="text-[11px] text-slate-400">@{u.username}</p>
                      </div>
                    </div>
                    {isCreatingGroup && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="rounded text-indigo-600"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {isCreatingGroup && (
              <button
                onClick={() => handleCreateChat()}
                className="w-full mt-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md cursor-pointer"
              >
                Create Group ({selectedGroupMembers.length} members)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface MessengerChatHeaderProps {
  selectedConversation: Conversation;
  otherParticipant: UserProfile | null;
  onBack: () => void;
  onInitiateCall: (user: UserProfile, type: 'audio' | 'video') => void;
}

const MessengerChatHeader: React.FC<MessengerChatHeaderProps> = ({
  selectedConversation,
  otherParticipant,
  onBack,
  onInitiateCall,
}) => {
  const presence = usePresence(otherParticipant?.uid);
  const liveOther = useLiveUserProfile(
    !selectedConversation.isGroup ? otherParticipant?.uid : null,
    {
      displayName: otherParticipant?.displayName,
      username: otherParticipant?.username,
      photoURL: otherParticipant?.photoURL,
    }
  );
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [otherParticipant?.uid, liveOther.photoURL]);

  const avatarSrc = selectedConversation.isGroup
    ? selectedConversation.groupPhoto || getDefaultAvatar(selectedConversation.id)
    : imgError
    ? getDefaultAvatar(otherParticipant?.uid)
    : liveOther.photoURL;

  const callTarget: UserProfile | null = otherParticipant
    ? {
        ...otherParticipant,
        displayName: liveOther.displayName || otherParticipant.displayName,
        username: liveOther.username || otherParticipant.username,
        photoURL: liveOther.photoURL,
        isVerified: liveOther.isVerified,
      }
    : null;

  return (
    <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 -ml-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 md:hidden cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="relative shrink-0">
          <img
            src={avatarSrc}
            alt="avatar"
            onError={() => setImgError(true)}
            className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700"
          />
          {!selectedConversation.isGroup && (
            <span
              title={presence.isOnline ? 'Online now' : presence.lastSeenText}
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                presence.isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
              }`}
            />
          )}
        </div>
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
              {selectedConversation.isGroup
                ? selectedConversation.groupName
                : liveOther.displayName || otherParticipant?.displayName}
            </h3>
            {otherParticipant && (
              <VerifiedBadge
                user={{ uid: otherParticipant.uid, isVerified: liveOther.isVerified }}
                size="xs"
              />
            )}
            {otherParticipant && <AdminBadge user={{ uid: otherParticipant.uid }} size="xs" />}
          </div>
          {!selectedConversation.isGroup && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium">
              <span
                className={`w-2 h-2 rounded-full ${
                  presence.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}
              />
              <span className={presence.isOnline ? 'text-emerald-500 font-semibold' : 'text-slate-400'}>
                {presence.isOnline ? 'Online' : presence.lastSeenText}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Instant Call Buttons for 1-on-1 */}
      {callTarget && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onInitiateCall(callTarget, 'audio')}
            className="p-2.5 rounded-full text-slate-600 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400 transition-colors cursor-pointer"
            title="Audio Call"
          >
            <Phone size={19} />
          </button>
          <button
            onClick={() => onInitiateCall(callTarget, 'video')}
            className="p-2.5 rounded-full text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-400 transition-colors cursor-pointer"
            title="Video Call"
          >
            <Video size={19} />
          </button>
        </div>
      )}
    </div>
  );
};

interface MessengerConversationItemProps {
  conv: Conversation;
  isSelected: boolean;
  onSelect: () => void;
  other: UserProfile | null;
}

const MessengerConversationItem: React.FC<MessengerConversationItemProps> = ({
  conv,
  isSelected,
  onSelect,
  other,
}) => {
  const presence = usePresence(other?.uid);
  const liveOther = useLiveUserProfile(!conv.isGroup ? other?.uid : null, {
    displayName: other?.displayName,
    username: other?.username,
    photoURL: other?.photoURL,
  });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [other?.uid, liveOther.photoURL]);

  const title = conv.isGroup ? conv.groupName : liveOther.displayName || other?.displayName || 'User';
  const photo = conv.isGroup
    ? conv.groupPhoto || getDefaultAvatar(conv.id)
    : imgError
    ? getDefaultAvatar(other?.uid)
    : liveOther.photoURL;

  return (
    <div
      onClick={onSelect}
      className={`p-3.5 flex items-center gap-3 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-indigo-50 dark:bg-slate-800/80 border-l-4 border-indigo-600'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800/40'
      }`}
    >
      <div className="relative shrink-0">
        <img
          src={photo}
          alt={title}
          onError={() => setImgError(true)}
          className="w-11 h-11 rounded-full object-cover border border-slate-200 dark:border-slate-700"
        />
        {!conv.isGroup && (
          <span
            title={presence.isOnline ? 'Online now' : presence.lastSeenText}
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
              presence.isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
            }`}
          />
        )}
      </div>
      <div className="flex-1 truncate">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5 truncate">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
              {title}
            </h4>
            {other && <VerifiedBadge user={{ uid: other.uid, isVerified: liveOther.isVerified }} size="xs" />}
            {other && <AdminBadge user={{ uid: other.uid }} size="xs" />}
          </div>
          <span className="text-[10px] text-slate-400 shrink-0">
            {conv.lastMessageAt
              ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : ''}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {conv.lastMessage || 'No messages yet'}
        </p>
      </div>
    </div>
  );
};

interface MessengerCallItemProps {
  item: CallHistoryItem;
  currentUserId: string;
  onCallBack: (callee: UserProfile, type: 'audio' | 'video') => void;
}

const MessengerCallItem: React.FC<MessengerCallItemProps> = ({
  item,
  currentUserId,
  onCallBack,
}) => {
  const isOutgoing = item.callerId === currentUserId;
  const otherUid = isOutgoing ? (item.receiverId || item.calleeId) : item.callerId;
  const fallbackName = isOutgoing ? item.calleeName : item.callerName;
  const fallbackPhoto = isOutgoing ? item.calleePhoto : item.callerPhoto;
  const presence = usePresence(otherUid);
  const liveOther = useLiveUserProfile(otherUid, {
    displayName: fallbackName,
    photoURL: fallbackPhoto,
  });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [otherUid, liveOther.photoURL]);

  const otherName = liveOther.displayName || fallbackName || 'Unknown User';
  const otherPhoto = imgError ? getDefaultAvatar(otherUid) : liveOther.photoURL;

  const effectiveType = item.callType || item.type || 'audio';
  const isVideo = effectiveType === 'video';
  const rawSeconds = item.durationSeconds ?? item.duration ?? 0;
  const isRejected = item.status === 'rejected';
  const isMissed = item.status === 'missed' || item.status === 'cancelled' || (item.status === 'ended' && rawSeconds === 0 && !(item.startedAt ?? item.connectedAt));
  const isUnanswered = isRejected || isMissed;
  const durationText = isUnanswered ? '00:00' : (item.durationFormatted || formatCallDuration(rawSeconds));

  const formatTimeOnly = (timestamp?: string | number | null) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const primaryTimestamp = item.startedAt || item.connectedAt || item.endedAt || item.createdAt;
  const dateLabel = (() => {
    if (!primaryTimestamp) return '';
    const date = new Date(primaryTimestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  })();

  const startTimeStr = formatTimeOnly(item.startedAt ?? item.connectedAt);
  const endTimeStr = formatTimeOnly(item.endedAt || item.createdAt);
  const timeRangeLabel =
    !isUnanswered && startTimeStr && endTimeStr
      ? `${startTimeStr} - ${endTimeStr}`
      : endTimeStr || startTimeStr || '';

  const statusLabel = isRejected
    ? 'Rejected'
    : isMissed
    ? isOutgoing
      ? 'No Answer'
      : 'Missed'
    : 'Answered';

  const directionLabel = isOutgoing ? 'Outgoing' : 'Incoming';

  const calleeProfile: UserProfile = {
    id: otherUid,
    uid: otherUid,
    displayName: otherName,
    username: liveOther.username || otherName.toLowerCase().replace(/\s+/g, '') || 'user',
    photoURL: liveOther.photoURL,
    isVerified: liveOther.isVerified,
    email: '',
    role: 'user',
  };

  return (
    <div className="p-3.5 flex items-center justify-between gap-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="relative shrink-0">
          <img
            src={otherPhoto}
            alt={otherName}
            onError={() => setImgError(true)}
            className="w-11 h-11 rounded-full object-cover border border-slate-200 dark:border-slate-700"
          />
          <span
            title={presence.isOnline ? 'Online now' : presence.lastSeenText}
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
              presence.isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
            }`}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
              {otherName}
            </h4>
            <VerifiedBadge user={{ uid: otherUid, isVerified: liveOther.isVerified }} size="xs" />
            <AdminBadge user={{ uid: otherUid }} size="xs" />
          </div>

          {/* Line 1: Direction, Call Type (Audio/Video), Status, Duration */}
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              {isUnanswered ? (
                <PhoneMissed size={11} className="text-rose-500 shrink-0" />
              ) : isOutgoing ? (
                <PhoneOutgoing size={11} className="text-blue-500 shrink-0" />
              ) : (
                <PhoneIncoming size={11} className="text-emerald-500 shrink-0" />
              )}
              <span
                className={`font-semibold ${
                  isUnanswered
                    ? 'text-rose-500'
                    : isOutgoing
                    ? 'text-blue-500'
                    : 'text-emerald-500'
                }`}
              >
                {directionLabel}
              </span>
            </span>

            <span className="text-slate-300 dark:text-slate-700">•</span>

            <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium">
              {isVideo ? (
                <Video size={11} className="text-indigo-500 shrink-0" />
              ) : (
                <Phone size={11} className="text-emerald-500 shrink-0" />
              )}
              <span>{isVideo ? 'Video' : 'Audio'}</span>
            </span>

            <span className="text-slate-300 dark:text-slate-700">•</span>

            <span className={isUnanswered ? 'text-rose-500 font-medium' : 'text-emerald-600 dark:text-emerald-400 font-medium'}>
              {statusLabel}
            </span>

            <span className="text-slate-300 dark:text-slate-700">•</span>

            <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
              {durationText}
            </span>
          </div>

          {/* Line 2: Date & Start/End Time */}
          {(dateLabel || timeRangeLabel) && (
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 truncate">
              {dateLabel && <span>{dateLabel}</span>}
              {dateLabel && timeRangeLabel && <span>•</span>}
              {timeRangeLabel && <span>{timeRangeLabel}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Call-Back Action Buttons */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => onCallBack(calleeProfile, 'audio')}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400 transition-colors cursor-pointer"
          title={`Audio call ${otherName}`}
        >
          <Phone size={15} />
        </button>
        <button
          onClick={() => onCallBack(calleeProfile, 'video')}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-400 transition-colors cursor-pointer"
          title={`Video call ${otherName}`}
        >
          <Video size={15} />
        </button>
      </div>
    </div>
  );
};
