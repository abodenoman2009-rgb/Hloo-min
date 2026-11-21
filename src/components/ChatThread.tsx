import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCheck,
  Flag,
  Image as ImageIcon,
  Info,
  MapPin,
  Mic,
  Phone,
  Send,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { t } from '../i18n';
import { api } from '../lib/api';
import {
  formatMessageTime,
  getConversationDisplay,
  getMessageReadStatus,
} from '../lib/connectLogic';
import type { Conversation, Language, Message, UserProfile } from '../types';
import { Avatar } from './Avatar';

interface ChatThreadProps {
  lang: Language;
  currentUser: UserProfile;
  conversation: Conversation | null;
  messages: Message[];
  typingUserName: string | null;
  onSendMessage: (payload: {
    type: 'text' | 'image' | 'audio' | 'location';
    content: string;
    media_url?: string | null;
    media_meta?: Record<string, unknown> | null;
  }) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  onStartCall: (type: 'audio' | 'video') => void;
  onBackMobile?: () => void;
  onBlockUser: (userId: string) => Promise<void>;
  onReportUser: (user: UserProfile) => void;
}

export function ChatThread({
  lang,
  currentUser,
  conversation,
  messages,
  typingUserName,
  onSendMessage,
  onDeleteMessage,
  onTyping,
  onStartCall,
  onBackMobile,
  onBlockUser,
  onReportUser,
}: ChatThreadProps) {
  const dict = t(lang);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    setShowInfo(false);
    setComposerError(null);
  }, [conversation?.id]);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50 dark:bg-slate-950">
        <div className="max-w-md space-y-3">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {dict.selectConversation}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {dict.selectConversationDesc}
          </p>
        </div>
      </div>
    );
  }

  const disp = getConversationDisplay(conversation, currentUser.id, lang);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending || conversation?.is_blocked) return;
    setSending(true);
    setComposerError(null);
    try {
      onTyping(false);
      await onSendMessage({ type: 'text', content: trimmed });
      setText('');
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  function handleTextChange(val: string) {
    setText(val);
    onTyping(val.trim().length > 0);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      onTyping(false);
    }, 1800);
  }

  async function handleImageUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !conversation) return;
    setSending(true);
    setComposerError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const uploaded = await api.uploadMedia(dataUrl, file.type);
      await onSendMessage({
        type: 'image',
        content: file.name,
        media_url: uploaded.url,
      });
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setSending(false);
    }
  }

  async function handleToggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      if (timerRef.current) window.clearInterval(timerRef.current);
      setRecording(false);
      return;
    }

    setComposerError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const uploaded = await api.uploadMedia(String(reader.result), blob.type);
            await onSendMessage({
              type: 'audio',
              content: lang === 'ar' ? 'رسالة صوتية' : 'Voice note',
              media_url: uploaded.url,
              media_meta: { durationSec: recordSeconds },
            });
          } catch (err) {
            setComposerError(err instanceof Error ? err.message : 'Audio upload failed');
          }
        };
        reader.readAsDataURL(blob);
        setRecordSeconds(0);
      };
      recorderRef.current = mr;
      mr.start();
      setRecordSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setComposerError(
        lang === 'ar'
          ? 'الميكروفون غير متاح في هذا المتصفح.'
          : 'Microphone unavailable in this browser.'
      );
    }
  }

  async function handleShareLocation() {
    setComposerError(null);
    setSending(true);
    const publishCoords = async (lat: number, lng: number, address: string) => {
      try {
        await onSendMessage({
          type: 'location',
          content: address,
          media_meta: { lat, lng, address },
        });
      } finally {
        setSending(false);
      }
    };

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          publishCoords(
            Number(pos.coords.latitude.toFixed(4)),
            Number(pos.coords.longitude.toFixed(4)),
            lang === 'ar' ? 'موقعي الحالي' : 'My current location'
          );
        },
        () => {
          publishCoords(
            24.7136,
            46.6753,
            lang === 'ar' ? 'الرياض · موقع مشترك' : 'Riyadh · Shared Pin'
          );
        },
        { timeout: 4000 }
      );
    } else {
      await publishCoords(
        24.7136,
        46.6753,
        lang === 'ar' ? 'الرياض · موقع مشترك' : 'Riyadh · Shared Pin'
      );
    }
  }

  const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft;

  return (
    <div className="flex-1 flex h-full min-w-0 bg-slate-50 dark:bg-slate-950">
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Thread Header */}
        <header className="h-16 px-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {onBackMobile && (
              <button
                type="button"
                onClick={onBackMobile}
                className="lg:hidden min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                aria-label={lang === 'ar' ? 'رجوع' : 'Back'}
              >
                <BackIcon className="w-5 h-5" />
              </button>
            )}
            <Avatar
              src={disp.avatarUrl}
              name={disp.title}
              size="md"
              isOnline={disp.isOnline}
              isGroup={conversation.type === 'group'}
            />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {disp.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {typingUserName
                  ? `${typingUserName} · ${dict.typing}`
                  : disp.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onStartCall('audio')}
              disabled={conversation.is_blocked}
              aria-label={dict.audioCall}
              className="min-h-[40px] min-w-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Phone className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span className="hidden sm:inline">{dict.audioCall}</span>
            </button>
            <button
              type="button"
              onClick={() => onStartCall('video')}
              disabled={conversation.is_blocked}
              aria-label={dict.videoCall}
              className="min-h-[40px] min-w-[40px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Video className="w-4 h-4" />
              <span className="hidden sm:inline">{dict.videoCall}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              aria-label={dict.chatInfo}
              aria-expanded={showInfo}
              className={`min-h-[40px] min-w-[40px] rounded-xl border inline-flex items-center justify-center transition-colors ${
                showInfo
                  ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-3">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              {lang === 'ar'
                ? 'لا توجد رسائل بعد. أرسل تحيتك الأولى!'
                : 'No messages yet. Say hello!'}
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender_id === currentUser.id;
              const readStatus = isMine
                ? getMessageReadStatus(msg, conversation, lang)
                : null;

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2.5 group ${
                    isMine ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {!isMine && (
                    <Avatar
                      src={msg.sender?.avatar_url}
                      name={msg.sender?.full_name || 'U'}
                      size="xs"
                    />
                  )}
                  <div
                    className={`max-w-[78%] sm:max-w-[65%] rounded-2xl px-4 py-2.5 border ${
                      isMine
                        ? 'bg-emerald-700 border-emerald-700 text-white rounded-ee-sm'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-es-sm'
                    }`}
                  >
                    {!isMine && conversation.type === 'group' && msg.sender && (
                      <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                        {msg.sender.full_name}
                      </div>
                    )}

                    {msg.is_deleted ? (
                      <p className="text-xs italic opacity-75">
                        {dict.messageDeleted}
                      </p>
                    ) : msg.type === 'image' && msg.media_url ? (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(msg.media_url)}
                          className="block rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        >
                          <img
                            src={msg.media_url}
                            alt={msg.content || 'Image'}
                            referrerPolicy="no-referrer"
                            className="max-h-64 w-auto object-cover rounded-xl"
                          />
                        </button>
                      </div>
                    ) : msg.type === 'audio' && msg.media_url ? (
                      <div className="space-y-1 min-w-[210px]">
                        <audio controls src={msg.media_url} className="w-full h-9" />
                      </div>
                    ) : msg.type === 'location' && msg.media_meta ? (
                      <div className="flex items-start gap-2.5">
                        <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                        <div className="text-xs space-y-0.5">
                          <div className="font-semibold">
                            {msg.media_meta.address || dict.locationLabel}
                          </div>
                          <div className="font-mono-tabular opacity-85">
                            {msg.media_meta.lat}, {msg.media_meta.lng}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    )}

                    <div
                      className={`mt-1.5 flex items-center justify-end gap-2 text-[11px] ${
                        isMine
                          ? 'text-emerald-100/85'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      <span className="font-mono-tabular">
                        {formatMessageTime(msg.created_at, lang)}
                      </span>
                      {isMine && !msg.is_deleted && readStatus && (
                        <>
                          <span
                            data-read-status={readStatus.status}
                            title={readStatus.ariaLabel}
                            aria-label={readStatus.ariaLabel}
                            className={`inline-flex items-center gap-1 whitespace-nowrap ${
                              readStatus.readCount > 0
                                ? 'text-sky-200 font-semibold'
                                : 'text-emerald-100/75'
                            }`}
                          >
                            {readStatus.readCount > 0 ? (
                              <CheckCheck
                                className="w-4 h-4 shrink-0"
                                strokeWidth={2.4}
                                aria-hidden="true"
                              />
                            ) : (
                              <Check
                                className="w-3.5 h-3.5 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            <span>{readStatus.shortLabel}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => onDeleteMessage(msg.id)}
                            aria-label={`${dict.deleteMessage} ${msg.id}`}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:text-red-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
          {composerError && (
            <div className="mb-2 text-xs text-red-600 dark:text-red-400">
              {composerError}
            </div>
          )}

          {conversation.is_blocked ? (
            <div className="py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 text-center">
              {dict.blockedBanner}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || recording}
                aria-label={dict.attachImage}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors shrink-0"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleShareLocation}
                disabled={sending || recording}
                aria-label={dict.shareLocation}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors shrink-0"
              >
                <MapPin className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleToggleRecording}
                disabled={sending}
                aria-label={recording ? dict.stopRecording : dict.voiceNote}
                className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-colors shrink-0 ${
                  recording
                    ? 'bg-red-600 border-red-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {recording ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span className="font-mono-tabular text-xs">{recordSeconds}s</span>
                  </>
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>

              <input
                type="text"
                value={text}
                onChange={(e) => handleTextChange(e.target.value)}
                disabled={recording}
                placeholder={recording ? dict.recordingNow : dict.typeMessage}
                aria-label={dict.typeMessage}
                className="flex-1 h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />

              <button
                type="submit"
                disabled={sending || recording || !text.trim()}
                aria-label={dict.send}
                className="min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">{dict.send}</span>
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Right Details Drawer */}
      {showInfo && (
        <aside className="w-72 border-s border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col gap-5 shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {dict.chatInfo}
            </h3>
            <button
              type="button"
              onClick={() => setShowInfo(false)}
              aria-label="Close details"
              className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col items-center text-center gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
            <Avatar
              src={disp.avatarUrl}
              name={disp.title}
              size="xl"
              isOnline={disp.isOnline}
              isGroup={conversation.type === 'group'}
            />
            <div className="text-base font-bold text-slate-900 dark:text-white">
              {disp.title}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {disp.subtitle}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {dict.participants} ({conversation.participants.length})
            </div>
            <div className="space-y-2.5">
              {conversation.participants.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar
                      src={p.avatar_url}
                      name={p.full_name}
                      size="xs"
                      isOnline={p.is_online}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {p.full_name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        <span dir="ltr" className="inline-block">@{p.username}</span>
                      </div>
                    </div>
                  </div>
                  {p.id !== currentUser.id && (
                    <button
                      type="button"
                      onClick={() => onReportUser(p)}
                      aria-label={`${dict.reportUser} ${p.full_name}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {disp.otherPeer && (
            <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <button
                type="button"
                onClick={() => onBlockUser(disp.otherPeer!.id)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Ban className="w-4 h-4" />
                <span>{dict.blockUser}</span>
              </button>
              <button
                type="button"
                onClick={() => onReportUser(disp.otherPeer!)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Flag className="w-4 h-4" />
                <span>{dict.reportUser}</span>
              </button>
            </div>
          )}
        </aside>
      )}

      {/* Image Lightbox */}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close image"
            className="absolute top-4 end-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="Attachment preview"
            className="max-w-full max-h-[85vh] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
