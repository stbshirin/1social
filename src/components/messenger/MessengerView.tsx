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
  setDoc,
  updateDoc,
  orderBy,
  serverTimestamp,
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
import { subscribeToUserCallHistory, formatCallDuration } from '../../services/callHistoryService';

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
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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

  // Load conversations where current user is a participant
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', currentUser.uid)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Conversation));
        list.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
        setConversations(list);
      },
      (error) => {
        console.warn('Conversations listener notice:', error?.message || error);
      }
    );

    return () => unsub();
  }, [currentUser]);

  // Load all socialApp users for starting a new chat
  useEffect(() => {
    if (!currentUser) return;
    const fetchUsers = async () => {
      const snap = await getDocs(getSocialUsersCollection());
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as UserProfile))
        .filter((u) => u.uid !== currentUser.uid);
      setAllUsers(list);
    };
    fetchUsers();
  }, [currentUser]);

  // Handle initialChatUser passed from outside (e.g. quick connect in sidebar or user profile)
  useEffect(() => {
    if (!initialChatUser || !currentUser || !userProfile) return;

    const startDirectChat = async () => {
      // Find existing 1-on-1 conversation
      const existing = conversations.find(
        (c) => !c.isGroup && c.participants.includes(initialChatUser.uid)
      );

      if (existing) {
        setSelectedConversation(existing);
      } else {
        // Create new conversation
        const convRef = doc(collection(db, 'conversations'));
        const newConv: Conversation = {
          id: convRef.id,
          participants: [currentUser.uid, initialChatUser.uid],
          participantDetails: {
            [currentUser.uid]: {
              displayName: userProfile.displayName,
              username: userProfile.username,
              photoURL: userProfile.photoURL,
            },
            [initialChatUser.uid]: {
              displayName: initialChatUser.displayName,
              username: initialChatUser.username,
              photoURL: initialChatUser.photoURL,
            },
          },
          isGroup: false,
          lastMessage: 'Conversation started',
          lastMessageSenderId: currentUser.uid,
          lastMessageAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        await setDoc(convRef, newConv);
        setSelectedConversation(newConv);
      }

      onClearInitialChatUser?.();
    };

    startDirectChat();
  }, [initialChatUser, conversations, currentUser, userProfile]);

  // Listen to messages of selected conversation
  useEffect(() => {
    if (!selectedConversation || !currentUser) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'conversations', selectedConversation.id, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Message));
        setMessages(list);

        // Play chime if a new message arrives from the other participant
        if (snapshot.docChanges().some((ch) => ch.type === 'added' && ch.doc.data().senderId !== currentUser.uid)) {
          soundEffects.playMessageNotification();
        }

        // Mark seenBy
        snapshot.docs.forEach(async (docSnap) => {
          const msg = docSnap.data() as Message;
          if (!msg.seenBy?.includes(currentUser.uid)) {
            try {
              await updateDoc(docSnap.ref, {
                seenBy: [...(msg.seenBy || []), currentUser.uid],
              });
            } catch (e) {
              // Non-blocking
            }
          }
        });
      },
      (error) => {
        console.warn('Messages listener notice:', error?.message || error);
      }
    );

    return () => unsub();
  }, [selectedConversation?.id, currentUser]);

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

  // Delete message
  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedConversation) return;
    try {
      await deleteDoc(doc(db, 'conversations', selectedConversation.id, 'messages', messageId));
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
      const existing = conversations.find(
        (c) => !c.isGroup && c.participants.includes(targetUser.uid)
      );

      if (existing) {
        setSelectedConversation(existing);
      } else {
        const convRef = doc(collection(db, 'conversations'));
        const newConv: Conversation = {
          id: convRef.id,
          participants: [currentUser.uid, targetUser.uid],
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
          lastMessageAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        await setDoc(convRef, newConv);
        setSelectedConversation(newConv);
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
    return (
      call.callerName?.toLowerCase().includes(q) ||
      call.calleeName?.toLowerCase().includes(q) ||
      call.durationFormatted?.toLowerCase().includes(q)
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
                      key={m.id}
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
                            onClick={() => handleDeleteMessage(m.id)}
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
                        <p className="text-xs font-bold text-slate-900 dark:text-white">{u.displayName}</p>
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
            src={
              selectedConversation.isGroup
                ? selectedConversation.groupPhoto
                : otherParticipant?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${otherParticipant?.uid}`
            }
            alt="avatar"
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
              {selectedConversation.isGroup ? selectedConversation.groupName : otherParticipant?.displayName}
            </h3>
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
                {presence.isOnline ? 'Active Now' : presence.lastSeenText}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Instant Call Buttons for 1-on-1 */}
      {otherParticipant && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onInitiateCall(otherParticipant, 'audio')}
            className="p-2.5 rounded-full text-slate-600 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400 transition-colors cursor-pointer"
            title="Audio Call"
          >
            <Phone size={19} />
          </button>
          <button
            onClick={() => onInitiateCall(otherParticipant, 'video')}
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
  const title = conv.isGroup ? conv.groupName : other?.displayName || 'User';
  const photo = conv.isGroup
    ? conv.groupPhoto
    : other?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${other?.uid}`;

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
  const otherUid = isOutgoing ? item.calleeId : item.callerId;
  const otherName = isOutgoing ? item.calleeName : item.callerName;
  const otherPhoto = isOutgoing ? item.calleePhoto : item.callerPhoto;
  const presence = usePresence(otherUid);

  const isMissed = item.status === 'rejected' || item.status === 'missed';
  const durationText = item.durationFormatted || formatCallDuration(item.duration);

  const formatCallDate = (timestamp?: string | number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Today, ${timeStr}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  };

  const calleeProfile: UserProfile = {
    id: otherUid,
    uid: otherUid,
    displayName: otherName || 'User',
    username: otherName?.toLowerCase().replace(/\s+/g, '') || 'user',
    photoURL: otherPhoto,
    email: '',
    role: 'user',
  };

  return (
    <div className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative shrink-0">
          <img
            src={otherPhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${otherUid}`}
            alt={otherName}
            className="w-11 h-11 rounded-full object-cover border border-slate-200 dark:border-slate-700"
          />
          <span
            title={presence.isOnline ? 'Online now' : presence.lastSeenText}
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
              presence.isOnline ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
            }`}
          />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
              {otherName}
            </h4>
            <AdminBadge user={{ uid: otherUid }} size="xs" />
          </div>

          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {/* Status & Direction */}
            <div className="flex items-center gap-1">
              {isMissed ? (
                <>
                  <PhoneMissed size={12} className="text-rose-500 shrink-0" />
                  <span className="text-rose-500 font-semibold text-[11px]">Missed</span>
                </>
              ) : isOutgoing ? (
                <>
                  <PhoneOutgoing size={12} className="text-blue-500 shrink-0" />
                  <span className="text-blue-500 font-medium text-[11px]">Outgoing</span>
                </>
              ) : (
                <>
                  <PhoneIncoming size={12} className="text-emerald-500 shrink-0" />
                  <span className="text-emerald-500 font-medium text-[11px]">Incoming</span>
                </>
              )}
            </div>

            <span className="text-slate-300 dark:text-slate-700">•</span>

            {/* Type & Duration */}
            <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
              {durationText}
            </span>

            <span className="text-slate-300 dark:text-slate-700">•</span>

            <span className="text-[10px] text-slate-400 truncate">
              {formatCallDate(item.createdAt || item.endedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Call-Back Action Buttons */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onCallBack(calleeProfile, 'audio')}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400 transition-colors cursor-pointer"
          title={`Audio call ${otherName}`}
        >
          <Phone size={16} />
        </button>
        <button
          onClick={() => onCallBack(calleeProfile, 'video')}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-400 transition-colors cursor-pointer"
          title={`Video call ${otherName}`}
        >
          <Video size={16} />
        </button>
      </div>
    </div>
  );
};
