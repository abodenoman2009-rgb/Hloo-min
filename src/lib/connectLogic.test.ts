import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canInitiateCall,
  computeUnreadCount,
  filterConversations,
  formatCallDuration,
  formatSecondsTimer,
  getConversationDisplay,
  getMessageReadStatus,
  normalizeUsername,
  validateAuthForm,
} from './connectLogic';
import type { AppSettings, Conversation, UserProfile } from '../types';

const layla: UserProfile = {
  id: 'u1',
  username: 'layla_mansoor',
  full_name: 'ليلى المنصور',
  email: 'layla@connect.app',
  avatar_url: null,
  bio: '',
  role: 'admin',
  is_banned: false,
  is_online: true,
  last_seen_at: '2026-11-21T10:00:00Z',
  created_at: '2026-11-01T10:00:00Z',
};

const tariq: UserProfile = {
  id: 'u2',
  username: 'tariq_harbi',
  full_name: 'طارق الحربي',
  email: 'tariq@connect.app',
  avatar_url: null,
  bio: '',
  role: 'user',
  is_banned: false,
  is_online: false,
  last_seen_at: '2026-11-21T09:00:00Z',
  created_at: '2026-11-01T10:00:00Z',
};

test('normalizeUsername strips invalid characters and enforces min/max length', () => {
  assert.equal(normalizeUsername('Tariq Al-Harbi!', 'a1b2c3d4'), 'tariq_al_harbi_a1b2c');
  assert.equal(normalizeUsername('ab', '12345'), 'user_ab_12345');
  assert.equal(normalizeUsername('   '), 'user_member');
});

test('formatCallDuration and formatSecondsTimer produce tabular MM:SS and HH:MM:SS', () => {
  assert.equal(
    formatCallDuration('2026-11-21T10:00:00Z', '2026-11-21T10:03:09Z'),
    '03:09'
  );
  assert.equal(
    formatCallDuration('2026-11-21T10:00:00Z', '2026-11-21T11:05:02Z'),
    '01:05:02'
  );
  assert.equal(formatSecondsTimer(75), '01:15');
});

test('computeUnreadCount excludes own messages, deleted messages, and read messages', () => {
  const messages = [
    { id: 'm1', sender_id: 'u2', is_deleted: false },
    { id: 'm2', sender_id: 'u2', is_deleted: false },
    { id: 'm3', sender_id: 'u1', is_deleted: false },
    { id: 'm4', sender_id: 'u2', is_deleted: true },
  ];
  const reads = [{ message_id: 'm1', user_id: 'u1' }];
  assert.equal(computeUnreadCount(messages, reads, 'u1'), 1);
});

test('canInitiateCall enforces global maintenance mode, audio/video flags, and participant cap', () => {
  const settings: AppSettings = {
    maintenance_mode: { enabled: false, message_ar: '', message_en: '' },
    calls_enabled: { audio: true, video: false, max_group_participants: 4 },
  };
  assert.deepEqual(canInitiateCall(settings, 'audio', 2), { allowed: true });
  assert.deepEqual(canInitiateCall(settings, 'video', 2), {
    allowed: false,
    reason: 'video_disabled',
  });
  assert.deepEqual(canInitiateCall(settings, 'audio', 6), {
    allowed: false,
    reason: 'max_participants',
  });

  const maintSettings: AppSettings = {
    ...settings,
    maintenance_mode: { enabled: true, message_ar: 'صيانة', message_en: 'Maint' },
  };
  assert.deepEqual(canInitiateCall(maintSettings, 'audio', 2, false), {
    allowed: false,
    reason: 'maintenance',
  });
  assert.deepEqual(canInitiateCall(maintSettings, 'audio', 2, true), {
    allowed: true,
  });
});

test('getConversationDisplay and filterConversations handle direct and group chats', () => {
  const convDirect: Conversation = {
    id: 'c1',
    type: 'direct',
    title: null,
    avatar_url: null,
    created_by: 'u1',
    last_message_at: '2026-11-21T10:00:00Z',
    created_at: '2026-11-21T09:00:00Z',
    participants: [layla, tariq],
    last_message: null,
    unread_count: 2,
  };
  const convGroup: Conversation = {
    id: 'c2',
    type: 'group',
    title: 'Connect Core',
    avatar_url: null,
    created_by: 'u1',
    last_message_at: '2026-11-21T10:05:00Z',
    created_at: '2026-11-21T09:00:00Z',
    participants: [layla, tariq],
    last_message: null,
    unread_count: 0,
  };

  const displayDirect = getConversationDisplay(convDirect, 'u1', 'en');
  assert.equal(displayDirect.title, 'طارق الحربي');
  assert.equal(displayDirect.subtitle, '@tariq_harbi');

  const displayGroup = getConversationDisplay(convGroup, 'u1', 'en');
  assert.equal(displayGroup.title, 'Connect Core');
  assert.equal(displayGroup.subtitle, '2 members · 0 online');

  assert.equal(filterConversations([convDirect, convGroup], '', 'unread', 'u1').length, 1);
  assert.equal(filterConversations([convDirect, convGroup], '', 'groups', 'u1').length, 1);
  assert.equal(filterConversations([convDirect, convGroup], 'tariq', 'all', 'u1').length, 2);
  assert.equal(filterConversations([convDirect, convGroup], 'Connect Core', 'all', 'u1').length, 1);
});

test('validateAuthForm validates login, signup confirmPassword, 6-digit OTP, and reset_password', () => {
  assert.ok(validateAuthForm('login', { email: 'bad', password: 'password123' }, 'en'));
  assert.ok(validateAuthForm('login', { email: 'a@b.com', password: '123' }, 'en'));
  assert.equal(validateAuthForm('login', { email: 'a@b.com', password: 'password123' }, 'en'), null);

  assert.ok(
    validateAuthForm(
      'signup',
      {
        email: 'a@b.com',
        password: 'password123',
        confirmPassword: 'different123',
        fullName: 'علي حسن',
      },
      'ar'
    )
  );
  assert.equal(
    validateAuthForm(
      'signup',
      {
        email: 'a@b.com',
        password: 'password123',
        confirmPassword: 'password123',
        fullName: 'علي حسن',
        username: 'ali_h',
      },
      'ar'
    ),
    null
  );

  assert.ok(validateAuthForm('verify_otp', { email: 'a@b.com', otp: '12345' }, 'en'));
  assert.equal(validateAuthForm('verify_otp', { email: 'a@b.com', otp: '482910' }, 'en'), null);

  assert.ok(
    validateAuthForm(
      'reset_password',
      { email: 'a@b.com', otp: '482910', password: 'short', confirmPassword: 'short' },
      'en'
    )
  );
  assert.equal(
    validateAuthForm(
      'reset_password',
      {
        email: 'a@b.com',
        otp: '482910',
        password: 'newpassword123',
        confirmPassword: 'newpassword123',
      },
      'en'
    ),
    null
  );
});

test('OTP cooldown, attempt lockout, and Apple Private Relay helpers behave deterministically', async () => {
  const { isApplePrivateRelayEmail, getResendCooldownRemaining, isAttemptLimitReached } =
    await import('./connectLogic');

  assert.equal(isApplePrivateRelayEmail('xyz123@privaterelay.appleid.com'), true);
  assert.equal(isApplePrivateRelayEmail('user@icloud.com', true), true);
  assert.equal(isApplePrivateRelayEmail('user@icloud.com', false), false);

  const now = Date.parse('2026-11-21T12:00:00.000Z');
  assert.equal(getResendCooldownRemaining('2026-11-21T12:00:25.000Z', now), 25);
  assert.equal(getResendCooldownRemaining('2026-11-21T11:59:50.000Z', now), 0);

  assert.equal(isAttemptLimitReached(4, 5), false);
  assert.equal(isAttemptLimitReached(5, 5), true);
});

test('getMessageReadStatus processes reads for direct and group conversations', () => {
  const nadia: UserProfile = {
    ...tariq,
    id: 'u3',
    username: 'nadia_karim',
    full_name: 'نادية كريم',
  };

  const directStatusUnread = getMessageReadStatus(
    { sender_id: 'u1', is_deleted: false, reads: [] },
    { type: 'direct', participants: [layla, tariq] },
    'en'
  );
  assert.equal(directStatusUnread.status, 'sent');
  assert.equal(directStatusUnread.readCount, 0);
  assert.equal(directStatusUnread.shortLabel, 'Sent');

  const directStatusRead = getMessageReadStatus(
    {
      sender_id: 'u1',
      is_deleted: false,
      reads: [
        { message_id: 'm1', user_id: 'u1', read_at: '2026-11-21T10:01:00Z' },
        { message_id: 'm1', user_id: 'u2', read_at: '2026-11-21T10:02:00Z' },
        { message_id: 'm1', user_id: 'u2', read_at: '2026-11-21T10:02:00Z' },
      ],
    },
    { type: 'direct', participants: [layla, tariq] },
    'ar'
  );
  assert.equal(directStatusRead.status, 'read_all');
  assert.equal(directStatusRead.readCount, 1);
  assert.equal(directStatusRead.shortLabel, 'قُرئت');

  const groupPartial = getMessageReadStatus(
    {
      sender_id: 'u1',
      is_deleted: false,
      reads: [{ message_id: 'm2', user_id: 'u2', read_at: '2026-11-21T10:02:00Z' }],
    },
    { type: 'group', participants: [layla, tariq, nadia] },
    'en'
  );
  assert.equal(groupPartial.status, 'read');
  assert.equal(groupPartial.readCount, 1);
  assert.equal(groupPartial.expectedReaders, 2);
  assert.equal(groupPartial.shortLabel, 'Read 1/2');
});

test('mapFirebaseAuthErrorCode translates Google Sign-In errors for Arabic and English UI', async () => {
  const { mapFirebaseAuthErrorCode } = await import('./connectLogic');

  const closedAr = mapFirebaseAuthErrorCode('auth/popup-closed-by-user', 'ar');
  assert.ok(closedAr && closedAr.includes('Google'));
  assert.ok(!closedAr.includes('Firebase: Error'));

  const blockedEn = mapFirebaseAuthErrorCode('auth/popup-blocked', 'en');
  assert.ok(blockedEn && blockedEn.toLowerCase().includes('popup'));

  const unauthAr = mapFirebaseAuthErrorCode('auth/unauthorized-domain', 'ar');
  assert.ok(unauthAr && unauthAr.includes('النطاق'));

  assert.equal(mapFirebaseAuthErrorCode('auth/unknown-code', 'en'), null);
});

