import type {
  AppSettings,
  CallType,
  ChatFilter,
  Conversation,
  Language,
  Message,
  MessageRead,
  UserProfile,
} from '../types';

/**
 * Normalizes a desired username or email local-part identically to the
 * PostgreSQL handle_new_user() trigger specification.
 */
export function normalizeUsername(raw: string, idSuffix = ''): string {
  let base = (raw || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (base.length < 3) {
    base = `user_${base || 'member'}`;
  }

  const trimmedBase = base.slice(0, 18);
  const cleanSuffix = idSuffix.replace(/[^a-z0-9]/gi, '').slice(0, 5).toLowerCase();
  return cleanSuffix ? `${trimmedBase}_${cleanSuffix}` : trimmedBase;
}

/**
 * Formats call duration as MM:SS (or HH:MM:SS when >= 1 hour) using tabular layout.
 */
export function formatCallDuration(
  startedAt: string,
  endedAt?: string | null,
  nowMs: number = Date.now()
): string {
  const startMs = Date.parse(startedAt);
  const endMs = endedAt ? Date.parse(endedAt) : nowMs;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return '00:00';
  }
  const totalSec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Formats an elapsed integer seconds count into MM:SS.
 */
export function formatSecondsTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Computes unread message count for a user in a conversation.
 */
export function computeUnreadCount(
  messages: Pick<Message, 'id' | 'sender_id' | 'is_deleted'>[],
  reads: Pick<MessageRead, 'message_id' | 'user_id'>[],
  currentUserId: string
): number {
  const readSet = new Set(
    reads.filter((r) => r.user_id === currentUserId).map((r) => r.message_id)
  );
  return messages.filter(
    (m) => !m.is_deleted && m.sender_id !== currentUserId && !readSet.has(m.id)
  ).length;
}

/**
 * Resolves display title, avatar, subtitle, and online state for a conversation.
 */
export function getConversationDisplay(
  conversation: Conversation,
  currentUserId: string,
  lang: Language
): {
  title: string;
  avatarUrl: string | null;
  initials: string;
  isOnline: boolean;
  subtitle: string;
  otherPeer: UserProfile | null;
} {
  if (conversation.type === 'group') {
    const title =
      conversation.title?.trim() ||
      (lang === 'ar' ? 'مجموعة بدون عنوان' : 'Untitled Group');
    const onlineCount = conversation.participants.filter(
      (p) => p.id !== currentUserId && p.is_online
    ).length;
    const memberCount = conversation.participants.length;
    const subtitle =
      lang === 'ar'
        ? `${memberCount} أعضاء · ${onlineCount} متصل`
        : `${memberCount} members · ${onlineCount} online`;
    return {
      title,
      avatarUrl: conversation.avatar_url,
      initials: getInitials(title),
      isOnline: onlineCount > 0,
      subtitle,
      otherPeer: null,
    };
  }

  const other =
    conversation.participants.find((p) => p.id !== currentUserId) ||
    conversation.participants[0] ||
    null;

  if (!other) {
    return {
      title: lang === 'ar' ? 'محادثة' : 'Conversation',
      avatarUrl: null,
      initials: 'C',
      isOnline: false,
      subtitle: '',
      otherPeer: null,
    };
  }

  const subtitle = other.is_online
    ? lang === 'ar'
      ? `متصل الآن · @${other.username}`
      : `Online · @${other.username}`
    : `@${other.username}`;

  return {
    title: other.full_name,
    avatarUrl: other.avatar_url,
    initials: getInitials(other.full_name),
    isOnline: other.is_online,
    subtitle,
    otherPeer: other,
  };
}

export function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

/**
 * Validates whether a user can initiate a call under current global app_settings.
 */
export function canInitiateCall(
  settings: AppSettings,
  callType: CallType,
  participantCount: number,
  isAdmin = false
): { allowed: boolean; reason?: 'maintenance' | 'audio_disabled' | 'video_disabled' | 'max_participants' } {
  if (settings.maintenance_mode.enabled && !isAdmin) {
    return { allowed: false, reason: 'maintenance' };
  }
  if (callType === 'audio' && !settings.calls_enabled.audio) {
    return { allowed: false, reason: 'audio_disabled' };
  }
  if (callType === 'video' && !settings.calls_enabled.video) {
    return { allowed: false, reason: 'video_disabled' };
  }
  if (participantCount > settings.calls_enabled.max_group_participants) {
    return { allowed: false, reason: 'max_participants' };
  }
  return { allowed: true };
}

/**
 * Filters conversations by search query and active sidebar filter tab.
 */
export function filterConversations(
  conversations: Conversation[],
  query: string,
  filter: ChatFilter,
  currentUserId: string
): Conversation[] {
  const q = query.trim().toLowerCase();

  return conversations.filter((conv) => {
    if (filter === 'unread' && conv.unread_count <= 0) {
      return false;
    }
    if (filter === 'groups' && conv.type !== 'group') {
      return false;
    }
    if (!q) return true;

    if (conv.title && conv.title.toLowerCase().includes(q)) return true;
    if (conv.last_message?.content.toLowerCase().includes(q)) return true;

    return conv.participants.some(
      (p) =>
        p.id !== currentUserId &&
        (p.full_name.toLowerCase().includes(q) ||
          p.username.toLowerCase().includes(q))
    );
  });
}

export type AuthValidationMode =
  | 'login'
  | 'signup'
  | 'verify_otp'
  | 'forgot_password'
  | 'reset_password';

/**
 * Validates auth form inputs cleanly without silently bypassing empty fields.
 */
export function validateAuthForm(
  mode: AuthValidationMode,
  fields: {
    email: string;
    password?: string;
    confirmPassword?: string;
    fullName?: string;
    username?: string;
    otp?: string;
  },
  lang: Language
): string | null {
  const email = (fields.email || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return lang === 'ar'
      ? 'يرجى إدخال بريد إلكتروني صحيح.'
      : 'Please enter a valid email address.';
  }

  if (mode === 'forgot_password') {
    return null;
  }

  if (mode === 'verify_otp') {
    const cleanOtp = (fields.otp || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanOtp)) {
      return lang === 'ar'
        ? 'يرجى إدخال رمز التحقق المكوّن من 6 أرقام.'
        : 'Please enter the 6-digit verification code.';
    }
    return null;
  }

  if (mode === 'reset_password') {
    const cleanOtp = (fields.otp || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanOtp)) {
      return lang === 'ar'
        ? 'يرجى إدخال رمز التحقق المكوّن من 6 أرقام.'
        : 'Please enter the 6-digit verification code.';
    }
  }

  const password = fields.password || '';
  if (password.length < 8 && (mode === 'signup' || mode === 'reset_password')) {
    return lang === 'ar'
      ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.'
      : 'Password must be at least 8 characters.';
  }
  if (mode === 'login' && password.length < 6) {
    return lang === 'ar'
      ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'
      : 'Password must be at least 6 characters.';
  }

  if (mode === 'signup' || mode === 'reset_password') {
    if (fields.confirmPassword !== undefined && password !== fields.confirmPassword) {
      return lang === 'ar'
        ? 'كلمتا المرور غير متطابقتين.'
        : 'Passwords do not match.';
    }
  }

  if (mode === 'signup') {
    if (!fields.fullName || fields.fullName.trim().length < 2) {
      return lang === 'ar'
        ? 'يرجى إدخال الاسم الكامل (حرفين على الأقل).'
        : 'Please enter your full name (at least 2 characters).';
    }
    if (fields.username && fields.username.trim().length > 0 && fields.username.trim().length < 3) {
      return lang === 'ar'
        ? 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل.'
        : 'Username must be at least 3 characters.';
    }
  }

  return null;
}

/**
 * Evaluates whether an Apple Sign-In email uses Apple Private Email Relay.
 */
export function isApplePrivateRelayEmail(
  email?: string | null,
  isPrivateClaim?: boolean | string
): boolean {
  if (isPrivateClaim === true || isPrivateClaim === 'true') return true;
  if (!email) return false;
  return email.trim().toLowerCase().endsWith('@privaterelay.appleid.com');
}

/**
 * Computes remaining cooldown seconds before OTP resend is allowed.
 */
export function getResendCooldownRemaining(
  resendAvailableAtIso: string | Date | null,
  nowMs: number = Date.now()
): number {
  if (!resendAvailableAtIso) return 0;
  const targetMs =
    resendAvailableAtIso instanceof Date
      ? resendAvailableAtIso.getTime()
      : Date.parse(resendAvailableAtIso);
  if (Number.isNaN(targetMs)) return 0;
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

/**
 * Checks whether OTP entry or password login is temporarily locked due to brute-force attempts.
 */
export function isAttemptLimitReached(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}

/**
 * Formats message timestamp for compact single-line display.
 */
export function formatMessageTime(isoDate: string, lang: Language): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface MessageReadStatus {
  status: 'sent' | 'read' | 'read_all';
  readCount: number;
  expectedReaders: number;
  readers: Array<{ userId: string; fullName: string; readAt: string }>;
  shortLabel: string;
  ariaLabel: string;
}

/**
 * Processes the `reads` field on a message against conversation participants
 * to determine whether the message has been sent, partially read, or read by all.
 */
export function getMessageReadStatus(
  message: Pick<Message, 'sender_id' | 'reads' | 'is_deleted'>,
  conversation: Pick<Conversation, 'type' | 'participants'>,
  lang: Language
): MessageReadStatus {
  if (message.is_deleted) {
    return {
      status: 'sent',
      readCount: 0,
      expectedReaders: 0,
      readers: [],
      shortLabel: '',
      ariaLabel: '',
    };
  }

  const participantMap = new Map(
    conversation.participants.map((p) => [p.id, p])
  );
  const otherParticipants = conversation.participants.filter(
    (p) => p.id !== message.sender_id
  );
  const expectedReaders = otherParticipants.length;

  const seenUserIds = new Set<string>();
  const readers: Array<{ userId: string; fullName: string; readAt: string }> = [];

  for (const r of message.reads || []) {
    if (r.user_id === message.sender_id || seenUserIds.has(r.user_id)) continue;
    seenUserIds.add(r.user_id);
    const participant = participantMap.get(r.user_id);
    readers.push({
      userId: r.user_id,
      fullName: participant?.full_name || r.user_id,
      readAt: r.read_at,
    });
  }

  const readCount = readers.length;
  if (readCount === 0) {
    const label = lang === 'ar' ? 'تم الإرسال' : 'Sent';
    return {
      status: 'sent',
      readCount: 0,
      expectedReaders,
      readers,
      shortLabel: label,
      ariaLabel: label,
    };
  }

  const status =
    expectedReaders > 0 && readCount >= expectedReaders ? 'read_all' : 'read';

  if (conversation.type === 'group') {
    const shortLabel =
      lang === 'ar'
        ? `قُرئت ${readCount}/${expectedReaders || readCount}`
        : `Read ${readCount}/${expectedReaders || readCount}`;
    const names = readers.map((r) => r.fullName).join(lang === 'ar' ? '، ' : ', ');
    const ariaLabel =
      lang === 'ar' ? `قرأها: ${names}` : `Read by: ${names}`;
    return { status, readCount, expectedReaders, readers, shortLabel, ariaLabel };
  }

  const shortLabel = lang === 'ar' ? 'قُرئت' : 'Read';
  const readTime = formatMessageTime(readers[0].readAt, lang);
  const ariaLabel = readTime
    ? lang === 'ar'
      ? `تمت القراءة · ${readTime}`
      : `Read · ${readTime}`
    : shortLabel;
  return { status, readCount, expectedReaders, readers, shortLabel, ariaLabel };
}

/**
 * Maps client-side Firebase Google Auth error codes into clear bilingual UX messages.
 */
export function mapFirebaseAuthErrorCode(
  code: string | undefined,
  lang: Language,
  host?: string
): string | null {
  if (!code) return null;
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return lang === 'ar'
        ? 'تم إغلاق نافذة تسجيل الدخول عبر Google قبل إكمال العملية. يمكنك المحاولة مرة أخرى.'
        : 'The Google sign-in window was closed before completing authentication.';
    case 'auth/popup-blocked':
      return lang === 'ar'
        ? 'قام المتصفح بحظر النافذة المنبثقة لتسجيل الدخول عبر Google. يرجى السماح بالنوافذ المنبثقة ثم المحاولة مجدداً.'
        : 'Your browser blocked the Google sign-in popup. Please allow popups and try again.';
    case 'auth/unauthorized-domain':
      return lang === 'ar'
        ? `هذا النطاق${host ? ` (${host})` : ''} غير مضاف إلى النطاقات المصرّح بها لتسجيل الدخول عبر Google. يمكنك الدخول بالبريد الإلكتروني الآن، ويجب على مالك التطبيق إضافة النطاق في Firebase Authentication ثم Authorized domains.`
        : `This domain${host ? ` (${host})` : ''} is not in the Google Sign-In authorized domains. You can still sign in with email; the app owner must add it under Firebase Authentication, Authorized domains.`;
    case 'auth/operation-not-allowed':
      return lang === 'ar'
        ? 'تسجيل الدخول عبر Google غير مفعّل في إعدادات المصادقة الحالية.'
        : 'Google Sign-In provider is not enabled in authentication settings.';
    case 'auth/account-exists-with-different-credential':
      return lang === 'ar'
        ? 'يوجد حساب مسجل بنفس البريد الإلكتروني عبر طريقة دخول أخرى. سجّل الدخول بالبريد الإلكتروني أو كلمة المرور ثم اربط الحساب.'
        : 'An account already exists with this email using a different sign-in method.';
    case 'auth/network-request-failed':
      return lang === 'ar'
        ? 'تعذر الاتصال بخدمة Google للتحقق. تحقق من اتصال الإنترنت وحاول مجدداً.'
        : 'Network error while connecting to Google Sign-In. Check your connection and try again.';
    case 'auth/too-many-requests':
      return lang === 'ar'
        ? 'تم إرسال محاولات كثيرة متتالية. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.'
        : 'Too many sign-in attempts. Please wait a moment and try again.';
    case 'auth/user-disabled':
      return lang === 'ar'
        ? 'تم تعطيل حساب Google هذا لدى مزوّد الخدمة.'
        : 'This Google account has been disabled.';
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/internal-error':
      return lang === 'ar'
        ? 'تعذر إتمام نافذة Google داخل هذا الإطار أو المتصفح. جرّب فتح التطبيق في تبويب مستقل أو السماح بالنوافذ المنبثقة.'
        : 'Unable to complete Google Sign-In inside this embedded frame. Try opening the app in a standalone browser tab.';
    default:
      return null;
  }
}


