import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Phone, Settings, Shield, Users } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { t } from './i18n';
import { api, getStoredToken, setStoredToken } from './lib/api';
import { canInitiateCall } from './lib/connectLogic';
import { auth } from './lib/firebase';
import { WebRTCManager } from './lib/webrtc';
import type {
  ActiveTab,
  AppSettings,
  CallRecord,
  ChatFilter,
  Conversation,
  Friendship,
  Language,
  Message,
  SignalPayload,
  ThemeMode,
  UserProfile,
} from './types';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChatThread } from './components/ChatThread';
import { FriendsView } from './components/FriendsView';
import { CallsView } from './components/CallsView';
import { AdminView } from './components/AdminView';
import { SettingsView } from './components/SettingsView';
import { CallOverlay } from './components/CallOverlay';
import { NewChatModal, ReportModal } from './components/Modals';

export default function App() {
  const [lang, setLang] = useState<Language>(() => {
    try {
      return localStorage.getItem('connect_lang') === 'en' ? 'en' : 'ar';
    } catch {
      return 'ar';
    }
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('connect_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const [booting, setBooting] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    maintenance_mode: { enabled: false, message_ar: '', message_en: '' },
    calls_enabled: { audio: true, video: true, max_group_participants: 8 },
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('chats');
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [typingByConv, setTypingByConv] = useState<Record<string, string>>({});

  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);

  const [newChatModal, setNewChatModal] = useState<'direct' | 'group' | null>(null);
  const [reportTarget, setReportTarget] = useState<UserProfile | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  // WebRTC & Call state
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallRecord | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [mediaWarning, setMediaWarning] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const rtcRef = useRef<WebRTCManager | null>(null);
  const selectedConvRef = useRef<string | null>(null);
  const activeCallRef = useRef<CallRecord | null>(null);

  selectedConvRef.current = selectedConvId;
  activeCallRef.current = activeCall;

  // Sync HTML dir, lang, and dark class
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('connect_lang', lang);
    } catch {}
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('connect_theme', theme);
    } catch {}
  }, [theme]);

  const loadWorkspaceData = useCallback(async () => {
    const [convsRes, friendsRes, callsRes] = await Promise.all([
      api.getConversations(),
      api.getFriendships(),
      api.getCalls(),
    ]);
    setConversations(convsRes.conversations);
    setFriendships(friendsRes.friendships);
    setCalls(callsRes.calls);
    setSelectedConvId((prev) => {
      if (prev && convsRes.conversations.some((c) => c.id === prev)) return prev;
      return convsRes.conversations[0]?.id || null;
    });
  }, []);

  // Boot persistent authenticated session (HttpOnly cookie on Web, or in-memory Bearer token)
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const session = await api.getSession();
        if (!cancelled && session.authenticated && session.user && session.settings) {
          if (session.wsToken) setStoredToken(session.wsToken);
          setCurrentUser(session.user);
          setAppSettings(session.settings);
          await loadWorkspaceData();
        } else {
          setStoredToken(null);
        }
      } catch {
        setStoredToken(null);
      }
    }

    init().finally(() => {
      if (!cancelled) setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadWorkspaceData]);

  // Load messages when selecting a conversation
  useEffect(() => {
    if (!currentUser || !selectedConvId) return;
    let cancelled = false;
    api
      .getMessages(selectedConvId)
      .then(async (res) => {
        if (cancelled) return;
        setMessagesByConv((prev) => ({ ...prev, [selectedConvId]: res.messages }));
        await api.markRead(selectedConvId).catch(() => {});
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConvId ? { ...c, unread_count: 0 } : c
          )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, selectedConvId]);

  const endLocalRtc = useCallback(() => {
    if (rtcRef.current) {
      rtcRef.current.cleanup();
      rtcRef.current = null;
    }
    setLocalStream(null);
    setRemoteStreams(new Map());
    setMediaWarning(false);
  }, []);

  // Real-time WebSocket Connection
  useEffect(() => {
    if (!currentUser) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let closedIntentionally = false;
    let reconnectTimer: number | null = null;

    function connectWs() {
      if (closedIntentionally) return;
      const token = getStoredToken();
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const { event: evName, payload } = JSON.parse(event.data);
          if (evName === 'presence:changed') {
            const { userId, isOnline } = payload as { userId: string; isOnline: boolean };
            setConversations((prev) =>
              prev.map((c) => ({
                ...c,
                participants: c.participants.map((p) =>
                  p.id === userId ? { ...p, is_online: isOnline } : p
                ),
              }))
            );
            setFriendships((prev) =>
              prev.map((f) =>
                f.other_user.id === userId
                  ? { ...f, other_user: { ...f.other_user, is_online: isOnline } }
                  : f
              )
            );
          } else if (evName === 'message:created') {
            const { conversationId, message } = payload as {
              conversationId: string;
              message: Message;
            };
            // Idempotent append
            setMessagesByConv((prev) => {
              const list = prev[conversationId] || [];
              if (list.some((m) => m.id === message.id)) return prev;
              return { ...prev, [conversationId]: [...list, message] };
            });
            const isViewing = selectedConvRef.current === conversationId;
            if (isViewing && message.sender_id !== currentUser?.id) {
              api.markRead(conversationId).catch(() => {});
            }
            setConversations((prev) => {
              const updated = prev.map((c) => {
                if (c.id !== conversationId) return c;
                const incUnread =
                  !isViewing && message.sender_id !== currentUser?.id ? 1 : 0;
                return {
                  ...c,
                  last_message: message,
                  last_message_at: message.created_at,
                  unread_count: isViewing ? 0 : c.unread_count + incUnread,
                };
              });
              return [...updated].sort((a, b) =>
                b.last_message_at.localeCompare(a.last_message_at)
              );
            });
          } else if (evName === 'message:deleted') {
            const { conversationId, messageId } = payload as {
              conversationId: string;
              messageId: string;
            };
            setMessagesByConv((prev) => ({
              ...prev,
              [conversationId]: (prev[conversationId] || []).map((m) =>
                m.id === messageId
                  ? { ...m, is_deleted: true, content: '', media_url: null }
                  : m
              ),
            }));
          } else if (evName === 'message:read') {
            const { conversationId, userId, messageIds, readAt } = payload as {
              conversationId: string;
              userId: string;
              messageIds: string[];
              readAt: string;
            };
            const setIds = new Set(messageIds);
            setMessagesByConv((prev) => ({
              ...prev,
              [conversationId]: (prev[conversationId] || []).map((m) => {
                if (!setIds.has(m.id)) return m;
                const reads = m.reads || [];
                if (reads.some((r) => r.user_id === userId)) return m;
                return {
                  ...m,
                  reads: [...reads, { message_id: m.id, user_id: userId, read_at: readAt }],
                };
              }),
            }));
          } else if (evName === 'typing:start') {
            const { conversationId, userId, fullName } = payload as {
              conversationId: string;
              userId: string;
              fullName: string;
            };
            if (userId !== currentUser?.id) {
              setTypingByConv((prev) => ({ ...prev, [conversationId]: fullName }));
            }
          } else if (evName === 'typing:stop') {
            const { conversationId, userId } = payload as {
              conversationId: string;
              userId: string;
            };
            if (userId !== currentUser?.id) {
              setTypingByConv((prev) => {
                const copy = { ...prev };
                delete copy[conversationId];
                return copy;
              });
            }
          } else if (evName === 'friendships:changed') {
            api
              .getFriendships()
              .then((res) => setFriendships(res.friendships))
              .catch(() => {});
          } else if (evName === 'conversations:changed') {
            api
              .getConversations()
              .then((res) => setConversations(res.conversations))
              .catch(() => {});
          } else if (evName === 'call:incoming') {
            const incoming = payload as CallRecord;
            if (!activeCallRef.current) {
              setIncomingCall(incoming);
            }
            api
              .getCalls()
              .then((res) => setCalls(res.calls))
              .catch(() => {});
          } else if (evName === 'call:updated') {
            const updated = payload as CallRecord;
            setCalls((prev) => {
              const exists = prev.some((c) => c.id === updated.id);
              return exists
                ? prev.map((c) => (c.id === updated.id ? updated : c))
                : [updated, ...prev];
            });
            if (
              activeCallRef.current?.id === updated.id &&
              (updated.status === 'ended' ||
                updated.status === 'declined' ||
                updated.status === 'missed')
            ) {
              endLocalRtc();
              setActiveCall(null);
            } else if (activeCallRef.current?.id === updated.id) {
              setActiveCall(updated);
            }
            if (
              incomingCall?.id === updated.id &&
              updated.status !== 'ringing'
            ) {
              setIncomingCall(null);
            }
          } else if (evName === 'webrtc:signal') {
            rtcRef.current?.handleSignal(payload as SignalPayload);
          } else if (evName === 'settings:updated') {
            setAppSettings(payload as AppSettings);
          } else if (evName === 'profile:updated') {
            const prof = payload as UserProfile;
            if (prof.id === currentUser?.id) setCurrentUser(prof);
            loadWorkspaceData().catch(() => {});
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!closedIntentionally) {
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };
    }

    connectWs();
    return () => {
      closedIntentionally = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [currentUser?.id, endLocalRtc, loadWorkspaceData]);

  function sendWsEvent(event: string, payload: unknown) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, payload }));
    }
  }

  async function startWebRTCForCall(call: CallRecord, initiateOffers: boolean) {
    if (!currentUser) return;
    endLocalRtc();
    const mgr = new WebRTCManager(
      call.id,
      currentUser.id,
      call.type,
      (sig) => sendWsEvent('webrtc:signal', sig),
      (streams) => setRemoteStreams(streams),
      () => {}
    );
    rtcRef.current = mgr;
    const { stream, mediaWarning: warn } = await mgr.init();
    setLocalStream(stream);
    setMediaWarning(warn);

    if (initiateOffers) {
      for (const p of call.participants) {
        if (p.user_id !== currentUser.id) {
          await mgr.callPeer(p.user_id);
        }
      }
    }
  }

  async function handleStartCall(conversationId: string, type: 'audio' | 'video') {
    if (!currentUser) return;
    setBannerError(null);
    const conv = conversations.find((c) => c.id === conversationId);
    const count = conv?.participants.length || 2;
    const check = canInitiateCall(
      appSettings,
      type,
      count,
      currentUser.role === 'admin'
    );
    if (!check.allowed) {
      setBannerError(
        lang === 'ar'
          ? 'تم تعطيل هذا النوع من المكالمات حالياً من إعدادات المشرف.'
          : `Call unavailable (${check.reason}).`
      );
      return;
    }

    try {
      const res = await api.initiateCall(conversationId, type);
      setActiveCall(res.call);
      setCalls((prev) => [res.call, ...prev]);
      await startWebRTCForCall(res.call, true);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Unable to start call');
    }
  }

  async function handleAnswerIncoming() {
    if (!incomingCall) return;
    const call = incomingCall;
    setIncomingCall(null);
    const res = await api.updateCall(call.id, 'join');
    setActiveCall(res.call);
    await startWebRTCForCall(res.call, false);
  }

  async function handleDeclineIncoming() {
    if (!incomingCall) return;
    const call = incomingCall;
    setIncomingCall(null);
    await api.updateCall(call.id, 'decline').catch(() => {});
  }

  async function handleEndActiveCall() {
    const call = activeCall;
    endLocalRtc();
    setActiveCall(null);
    if (call) {
      const res = await api.updateCall(call.id, 'end').catch(() => null);
      if (res) {
        setCalls((prev) => prev.map((c) => (c.id === res.call.id ? res.call : c)));
      }
    }
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-sm text-slate-500">
        {t(lang).brandFull}
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        lang={lang}
        theme={theme}
        onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
        onToggleTheme={() => setTheme((th) => (th === 'dark' ? 'light' : 'dark'))}
        onAuthenticated={async (token, user, settings) => {
          setStoredToken(token);
          setCurrentUser(user);
          setAppSettings(settings);
          await loadWorkspaceData();
        }}
      />
    );
  }

  const dict = t(lang);
  const selectedConversation =
    conversations.find((c) => c.id === selectedConvId) || null;
  const activeMessages = selectedConvId ? messagesByConv[selectedConvId] || [] : [];
  const pendingIncomingFriends = friendships.filter(
    (f) => f.status === 'pending' && f.direction === 'incoming'
  ).length;

  const isMaintenanceBlocked =
    appSettings.maintenance_mode.enabled && currentUser.role !== 'admin';

  const showMobileTabBar = !(activeTab === 'chats' && mobileShowDetail);
  const mobileNavItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof MessageSquare;
  }> = [
    { id: 'chats', label: dict.chats, icon: MessageSquare },
    { id: 'friends', label: dict.friends, icon: Users },
    { id: 'calls', label: dict.calls, icon: Phone },
    ...(currentUser.role === 'admin'
      ? [{ id: 'admin' as const, label: dict.admin, icon: Shield }]
      : []),
    { id: 'settings', label: dict.settings, icon: Settings },
  ];

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Global Maintenance / Policy Banner */}
      {(isMaintenanceBlocked || bannerError) && (
        <div
          role="status"
          className="px-4 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-900 text-xs font-medium text-amber-900 dark:text-amber-200 flex items-center justify-between gap-4 shrink-0"
        >
          <span>
            {bannerError ||
              (lang === 'ar'
                ? appSettings.maintenance_mode.message_ar || dict.maintenanceNotice
                : appSettings.maintenance_mode.message_en || dict.maintenanceNotice)}
          </span>
          {bannerError && (
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="underline shrink-0"
            >
              {dict.dismiss}
            </button>
          )}
        </div>
      )}

      {/* Main Responsive Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div
          className={`${
            mobileShowDetail ? 'hidden lg:flex' : 'flex'
          } w-full lg:w-auto h-full min-h-0`}
        >
          <Sidebar
            lang={lang}
            theme={theme}
            currentUser={currentUser}
            activeTab={activeTab}
            onSelectTab={(tab) => {
              setActiveTab(tab);
              setMobileShowDetail(tab !== 'chats');
            }}
            onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
            onToggleTheme={() =>
              setTheme((th) => (th === 'dark' ? 'light' : 'dark'))
            }
            conversations={conversations}
            selectedConversationId={selectedConvId}
            onSelectConversation={(id) => {
              setSelectedConvId(id);
              setMobileShowDetail(true);
            }}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            chatFilter={chatFilter}
            onChatFilterChange={setChatFilter}
            pendingFriendsCount={pendingIncomingFriends}
            onOpenNewChat={() => setNewChatModal('direct')}
            onOpenNewGroup={() => setNewChatModal('group')}
          />
        </div>

        <main
          className={`${
            mobileShowDetail ? 'flex' : 'hidden lg:flex'
          } flex-1 min-w-0 h-full min-h-0 flex-col ${
            showMobileTabBar ? 'pb-16 lg:pb-0' : ''
          }`}
        >
          {activeTab === 'chats' && (
            <ChatThread
              lang={lang}
              currentUser={currentUser}
              conversation={selectedConversation}
              messages={activeMessages}
              typingUserName={
                selectedConvId ? typingByConv[selectedConvId] || null : null
              }
              onSendMessage={async (payload) => {
                if (!selectedConvId) return;
                const res = await api.sendMessage(selectedConvId, payload);
                setMessagesByConv((prev) => {
                  const list = prev[selectedConvId] || [];
                  if (list.some((m) => m.id === res.message.id)) return prev;
                  return { ...prev, [selectedConvId]: [...list, res.message] };
                });
              }}
              onDeleteMessage={async (msgId) => {
                await api.deleteMessage(msgId);
              }}
              onTyping={(isTyping) => {
                if (!selectedConvId) return;
                sendWsEvent(isTyping ? 'typing:start' : 'typing:stop', {
                  conversationId: selectedConvId,
                });
              }}
              onStartCall={(type) => {
                if (selectedConvId) handleStartCall(selectedConvId, type);
              }}
              onBackMobile={() => setMobileShowDetail(false)}
              onBlockUser={async (uid) => {
                await api.sendFriendRequest(uid, 'blocked');
                await loadWorkspaceData();
              }}
              onReportUser={(u) => setReportTarget(u)}
            />
          )}

          {activeTab === 'friends' && (
            <FriendsView
              lang={lang}
              friendships={friendships}
              onRefreshFriendships={async () => {
                const res = await api.getFriendships();
                setFriendships(res.friendships);
                await loadWorkspaceData();
              }}
              onStartDirectChat={async (userId) => {
                const res = await api.createConversation({
                  type: 'direct',
                  participantIds: [userId],
                });
                await loadWorkspaceData();
                setSelectedConvId(res.conversation.id);
                setActiveTab('chats');
                setMobileShowDetail(true);
              }}
              onStartDirectCall={async (userId, type) => {
                const res = await api.createConversation({
                  type: 'direct',
                  participantIds: [userId],
                });
                await loadWorkspaceData();
                setSelectedConvId(res.conversation.id);
                await handleStartCall(res.conversation.id, type);
              }}
            />
          )}

          {activeTab === 'calls' && (
            <CallsView
              lang={lang}
              currentUser={currentUser}
              calls={calls}
              onRedial={(convId, type) => handleStartCall(convId, type)}
            />
          )}

          {activeTab === 'admin' && currentUser.role === 'admin' && (
            <AdminView
              lang={lang}
              currentUser={currentUser}
              onSettingsUpdated={(s) => setAppSettings(s)}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              lang={lang}
              theme={theme}
              currentUser={currentUser}
              onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
              onToggleTheme={() =>
                setTheme((th) => (th === 'dark' ? 'light' : 'dark'))
              }
              onProfileUpdated={(u) => setCurrentUser(u)}
              onSignOut={async () => {
                await api.logout().catch(() => {});
                await signOut(auth).catch(() => {});
                setStoredToken(null);
                endLocalRtc();
                setCurrentUser(null);
              }}
              onDeleteAccount={async () => {
                await api.deleteAccount();
                await signOut(auth).catch(() => {});
                setStoredToken(null);
                endLocalRtc();
                setCurrentUser(null);
              }}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (<lg, <= 15% sticky height cap) */}
      {showMobileTabBar && (
        <nav
          aria-label="Mobile navigation"
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 flex items-center justify-around px-1"
        >
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileShowDetail(item.id !== 'chats');
                }}
                className={`min-h-[44px] flex-1 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                  active
                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] leading-tight truncate max-w-[68px]">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Modals & Call Overlay */}
      <NewChatModal
        lang={lang}
        mode={newChatModal}
        onClose={() => setNewChatModal(null)}
        onCreateDirect={async (userId) => {
          const res = await api.createConversation({
            type: 'direct',
            participantIds: [userId],
          });
          await loadWorkspaceData();
          setSelectedConvId(res.conversation.id);
          setActiveTab('chats');
          setMobileShowDetail(true);
        }}
        onCreateGroup={async (title, memberIds) => {
          const res = await api.createConversation({
            type: 'group',
            participantIds: memberIds,
            title,
          });
          await loadWorkspaceData();
          setSelectedConvId(res.conversation.id);
          setActiveTab('chats');
          setMobileShowDetail(true);
        }}
      />

      <ReportModal
        lang={lang}
        targetUser={reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={async (userId, reason, details) => {
          await api.submitReport(userId, reason, details);
        }}
      />

      <CallOverlay
        lang={lang}
        currentUser={currentUser}
        activeCall={activeCall}
        incomingCall={incomingCall}
        localStream={localStream}
        remoteStreams={remoteStreams}
        mediaWarning={mediaWarning}
        onAnswerIncoming={handleAnswerIncoming}
        onDeclineIncoming={handleDeclineIncoming}
        onEndCall={handleEndActiveCall}
        onToggleMute={(m) => rtcRef.current?.toggleMute(m)}
        onToggleCamera={(c) => rtcRef.current?.toggleCamera(c)}
      />
    </div>
  );
}
