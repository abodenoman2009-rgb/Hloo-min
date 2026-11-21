export type Language = 'ar' | 'en';
export type ThemeMode = 'light' | 'dark';
export type UserRole = 'user' | 'admin';
export type FriendshipStatus = 'pending' | 'accepted' | 'declined' | 'blocked';
export type ConversationType = 'direct' | 'group';
export type MessageType = 'text' | 'image' | 'audio' | 'location' | 'system';
export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
export type CallParticipantStatus = 'invited' | 'joined' | 'left' | 'declined' | 'missed';
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  email: string;
  email_verified?: boolean;
  avatar_url: string | null;
  bio: string;
  role: UserRole;
  is_banned: boolean;
  is_online: boolean;
  last_seen_at: string;
  created_at: string;
}

export interface AuthSessionPayload {
  token: string;
  user: UserProfile;
  settings: AppSettings;
}

export interface AuthProvidersInfo {
  googleEnabled: boolean;
  googleClientId?: string | null;
  appleWebEnabled: boolean;
  appleNativeSupported: boolean;
  smtpConfigured: boolean;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
  other_user: UserProfile;
  direction: 'incoming' | 'outgoing';
}

export interface MessageRead {
  message_id: string;
  user_id: string;
  read_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: MessageType;
  content: string;
  media_url: string | null;
  media_meta: {
    lat?: number;
    lng?: number;
    address?: string;
    durationSec?: number;
    width?: number;
    height?: number;
  } | null;
  is_deleted: boolean;
  created_at: string;
  sender?: UserProfile;
  reads?: MessageRead[];
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string | null;
  avatar_url: string | null;
  created_by: string;
  last_message_at: string;
  created_at: string;
  participants: UserProfile[];
  last_message: Message | null;
  unread_count: number;
  is_blocked?: boolean;
}

export interface CallParticipant {
  call_id: string;
  user_id: string;
  status: CallParticipantStatus;
  joined_at: string | null;
  left_at: string | null;
  user?: UserProfile;
}

export interface CallRecord {
  id: string;
  conversation_id: string;
  caller_id: string;
  type: CallType;
  status: CallStatus;
  started_at: string;
  ended_at: string | null;
  caller?: UserProfile;
  conversation_title?: string | null;
  participants: CallParticipant[];
}

export interface ReportRecord {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  created_at: string;
  reporter?: UserProfile;
  reported_user?: UserProfile;
}

export interface MaintenanceSettings {
  enabled: boolean;
  message_ar: string;
  message_en: string;
}

export interface CallsSettings {
  audio: boolean;
  video: boolean;
  max_group_participants: number;
}

export interface AppSettings {
  maintenance_mode: MaintenanceSettings;
  calls_enabled: CallsSettings;
}

export type ActiveTab = 'chats' | 'friends' | 'calls' | 'admin' | 'settings';
export type ChatFilter = 'all' | 'unread' | 'groups';

export interface SignalPayload {
  type: 'offer' | 'answer' | 'ice-candidate' | 'hangup' | 'media-state';
  callId: string;
  from: string;
  to?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}
