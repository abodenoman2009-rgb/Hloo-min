import type {
  AppSettings,
  AuthProvidersInfo,
  AuthSessionPayload,
  CallRecord,
  Conversation,
  Friendship,
  Message,
  ReportRecord,
  ReportStatus,
  UserProfile,
  UserRole,
} from '../types';

// Keep runtime Bearer token in memory only (never localStorage/sessionStorage).
// Web persistence across page reloads uses HttpOnly; Secure; SameSite=None; Partitioned cookies,
// while native iOS/Android wrappers can hydrate setStoredToken() from Keychain / EncryptedSharedPreferences.
let inMemoryToken: string | null = null;

export function getStoredToken(): string | null {
  return inMemoryToken;
}

export function setStoredToken(token: string | null): void {
  inMemoryToken = token;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  retryAfterSeconds?: number;
  remainingAttempts?: number;
  email?: string;

  constructor(
    message: string,
    status: number,
    payload?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    if (payload) {
      if (typeof payload.code === 'string') this.code = payload.code;
      if (typeof payload.retryAfterSeconds === 'number') {
        this.retryAfterSeconds = payload.retryAfterSeconds;
      }
      if (typeof payload.remainingAttempts === 'number') {
        this.remainingAttempts = payload.remainingAttempts;
      }
      if (typeof payload.email === 'string') this.email = payload.email;
    }
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'ConnectClient',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      typeof data.error === 'string'
        ? data.error
        : `Request failed (${res.status})`;
    throw new ApiError(errMsg, res.status, data);
  }
  return data as T;
}

export const api = {
  getAuthProviders: () => request<AuthProvidersInfo>('/api/auth/providers'),

  signup: (payload: {
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
    username?: string;
  }) =>
    request<{
      verificationRequired: boolean;
      email: string;
      expiresInSeconds: number;
      resendCooldownSeconds: number;
    }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyOtp: (payload: { email: string; otp: string; platform?: string }) =>
    request<AuthSessionPayload>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ ...payload, platform: payload.platform || 'web' }),
    }),

  resendOtp: (payload: { email: string; purpose: 'signup' | 'reset_password' }) =>
    request<{
      sent: boolean;
      expiresInSeconds: number;
      resendCooldownSeconds: number;
    }>('/api/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (email: string, password: string) =>
    request<AuthSessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, platform: 'web' }),
    }),

  loginWithGoogle: (payload: { firebaseIdToken?: string; idToken?: string }) =>
    request<AuthSessionPayload>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ ...payload, platform: 'web' }),
    }),

  loginWithApple: (payload: { identityToken: string; fullName?: string }) =>
    request<AuthSessionPayload>('/api/auth/apple', {
      method: 'POST',
      body: JSON.stringify({ ...payload, platform: 'web' }),
    }),

  getAppleAuthUrl: () => request<{ url: string }>('/api/auth/apple/url'),

  forgotPassword: (email: string) =>
    request<{
      success: boolean;
      expiresInSeconds: number;
      resendCooldownSeconds: number;
    }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (payload: {
    email: string;
    otp: string;
    newPassword: string;
    confirmPassword: string;
  }) =>
    request<{ success: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  deleteAccount: () =>
    request<{ success: boolean }>('/api/auth/account', { method: 'DELETE' }),

  getSession: () =>
    request<{
      authenticated: boolean;
      user?: UserProfile;
      settings?: AppSettings;
      wsToken?: string;
    }>('/api/auth/session'),

  getMe: () =>
    request<{ user: UserProfile; settings: AppSettings; wsToken?: string }>('/api/me'),

  updateMe: (payload: {
    full_name?: string;
    username?: string;
    bio?: string;
    avatar_url?: string | null;
  }) =>
    request<{ user: UserProfile }>('/api/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  uploadMedia: (dataUrl: string, mimeType: string) =>
    request<{ url: string }>('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, mimeType }),
    }),

  searchUsers: (q: string) =>
    request<{ users: UserProfile[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),

  getFriendships: () => request<{ friendships: Friendship[] }>('/api/friendships'),

  sendFriendRequest: (addresseeId: string, status: 'pending' | 'blocked' = 'pending') =>
    request<{ friendships: Friendship[] }>('/api/friendships', {
      method: 'POST',
      body: JSON.stringify({ addresseeId, status }),
    }),

  updateFriendship: (id: string, status: 'accepted' | 'declined' | 'blocked') =>
    request<{ friendships: Friendship[] }>(`/api/friendships/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  deleteFriendship: (id: string) =>
    request<{ friendships: Friendship[] }>(`/api/friendships/${id}`, {
      method: 'DELETE',
    }),

  getConversations: () => request<{ conversations: Conversation[] }>('/api/conversations'),

  createConversation: (payload: {
    type: 'direct' | 'group';
    participantIds: string[];
    title?: string;
  }) =>
    request<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMessages: (conversationId: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${conversationId}/messages`),

  sendMessage: (
    conversationId: string,
    payload: {
      type: 'text' | 'image' | 'audio' | 'location';
      content: string;
      media_url?: string | null;
      media_meta?: Record<string, unknown> | null;
    }
  ) =>
    request<{ message: Message }>(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  markRead: (conversationId: string) =>
    request<{ readCount: number }>(`/api/conversations/${conversationId}/read`, {
      method: 'POST',
    }),

  deleteMessage: (messageId: string) =>
    request<{ success: boolean }>(`/api/messages/${messageId}`, {
      method: 'DELETE',
    }),

  getIceServers: () => request<{ iceServers: RTCIceServer[] }>('/api/webrtc/ice-servers'),

  getCalls: () => request<{ calls: CallRecord[] }>('/api/calls'),

  initiateCall: (conversationId: string, type: 'audio' | 'video') =>
    request<{ call: CallRecord }>('/api/calls', {
      method: 'POST',
      body: JSON.stringify({ conversationId, type }),
    }),

  updateCall: (callId: string, action: 'join' | 'decline' | 'end') =>
    request<{ call: CallRecord }>(`/api/calls/${callId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    }),

  submitReport: (reportedUserId: string, reason: string, details?: string) =>
    request<{ success: boolean; id: string }>('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ reportedUserId, reason, details }),
    }),

  getAdminOverview: () =>
    request<{
      users: UserProfile[];
      reports: ReportRecord[];
      settings: AppSettings;
      callCount: number;
    }>('/api/admin/overview'),

  updateReportStatus: (id: string, status: ReportStatus) =>
    request<{ reports: ReportRecord[] }>(`/api/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  adminUpdateUser: (id: string, payload: { is_banned?: boolean; role?: UserRole }) =>
    request<{ users: UserProfile[] }>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminUpdateSetting: (key: 'maintenance_mode' | 'calls_enabled', value: unknown) =>
    request<{ settings: AppSettings }>(`/api/admin/settings/${key}`, {
      method: 'PATCH',
      body: JSON.stringify(value),
    }),
};
