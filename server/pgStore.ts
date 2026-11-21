import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  appSettings,
  callParticipants,
  calls,
  conversationParticipants,
  conversations,
  emailVerifications,
  friendships,
  messageReads,
  messages,
  oauthAccounts,
  reports,
  sessions,
  users,
} from '../src/db/schema.ts';
import type {
  AppSettings,
  CallParticipant,
  CallRecord,
  Conversation,
  Friendship,
  Message,
  MessageRead,
  ReportRecord,
  ReportStatus,
  UserProfile,
  UserRole,
} from '../src/types.ts';
import { computeUnreadCount, normalizeUsername } from '../src/lib/connectLogic.ts';
import {
  generateNumericOtp,
  hashOtpCode,
  hashPasswordArgon2,
  hashSessionJti,
  signSessionJwt,
  verifyOtpHash,
  verifyPasswordHash,
  verifySessionJwt,
  type VerifiedOAuthProfile,
} from './authCrypto.ts';

export const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

export class AuthDomainError extends Error {
  statusCode: number;
  code: string;
  extra?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    extra?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

type UserRow = typeof users.$inferSelect;

export function toProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    username: row.username,
    full_name: row.fullName,
    email: row.email,
    email_verified: row.emailVerified,
    avatar_url: row.avatarUrl ?? null,
    bio: row.bio || '',
    role: row.role === 'admin' ? 'admin' : 'user',
    is_banned: Boolean(row.isBanned),
    is_online: Boolean(row.isOnline),
    last_seen_at:
      row.lastSeenAt instanceof Date
        ? row.lastSeenAt.toISOString()
        : String(row.lastSeenAt),
    created_at:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

let seedPromise: Promise<void> | null = null;

/**
 * Lazily seeds initial app settings and sample Connect workspace data on first DB interaction.
 * Never invoked eagerly at module import time to avoid Cloud SQL Auth Proxy startup storms.
 */
export async function ensureInitialized(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runLazySeed().catch((err) => {
      seedPromise = null;
      console.error('Database initialization failed:', err);
      throw new Error('Database initialization failed. Please try again shortly.', {
        cause: err,
      });
    });
  }
  return seedPromise;
}

async function runLazySeed(): Promise<void> {
  const now = new Date();
  await db
    .insert(appSettings)
    .values([
      {
        key: 'maintenance_mode',
        value: JSON.stringify({ enabled: false, message_ar: '', message_en: '' }),
        updatedAt: now,
      },
      {
        key: 'calls_enabled',
        value: JSON.stringify({
          audio: true,
          video: true,
          max_group_participants: 8,
        }),
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();

  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .limit(1);

  if (existingUsers.length > 0) {
    // Reset stale online flags after server restart until sockets reconnect
    await db.update(users).set({ isOnline: false });
    return;
  }

  const defaultHash = await hashPasswordArgon2('password123');
  const offset = (ms: number) => new Date(now.getTime() + ms);

  const seedUsers = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'layla_mansoor',
      fullName: 'ليلى المنصور',
      email: 'layla@connect.app',
      avatarUrl: '/src/assets/images/avatar_layla_1795268618918.jpg',
      bio: 'مديرة المنتج والمشرف العام على منصة كونكت',
      role: 'admin',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      username: 'tariq_harbi',
      fullName: 'طارق الحربي',
      email: 'tariq@connect.app',
      avatarUrl: '/src/assets/images/avatar_tariq_1795268619803.jpg',
      bio: 'مهندس البنية السحابية و WebRTC',
      role: 'user',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      username: 'nadia_karim',
      fullName: 'نادية كريم',
      email: 'nadia@connect.app',
      avatarUrl: '/src/assets/images/avatar_nadia_1795268618887.jpg',
      bio: 'مصممة واجهات وتجربة المستخدم RTL/LTR',
      role: 'user',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      username: 'omar_haddad',
      fullName: 'عمر حداد',
      email: 'omar@connect.app',
      avatarUrl: '/src/assets/images/avatar_omar_1795268619186.jpg',
      bio: 'مطور تطبيقات الجوال والإشعارات الفورية',
      role: 'user',
    },
  ];

  await db
    .insert(users)
    .values(
      seedUsers.map((u) => ({
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        email: u.email,
        passwordHash: defaultHash,
        emailVerified: true,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        role: u.role,
        isBanned: false,
        isOnline: false,
        lastSeenAt: offset(-120000),
        createdAt: offset(-86400000 * 14),
        updatedAt: offset(-120000),
      }))
    )
    .onConflictDoNothing();

  await db
    .insert(friendships)
    .values([
      {
        id: 'f1',
        requesterId: seedUsers[0].id,
        addresseeId: seedUsers[1].id,
        status: 'accepted',
        createdAt: offset(-86400000 * 5),
        updatedAt: offset(-86400000 * 5),
      },
      {
        id: 'f2',
        requesterId: seedUsers[0].id,
        addresseeId: seedUsers[2].id,
        status: 'accepted',
        createdAt: offset(-86400000 * 4),
        updatedAt: offset(-86400000 * 4),
      },
      {
        id: 'f3',
        requesterId: seedUsers[3].id,
        addresseeId: seedUsers[0].id,
        status: 'pending',
        createdAt: offset(-3600000 * 2),
        updatedAt: offset(-3600000 * 2),
      },
      {
        id: 'f4',
        requesterId: seedUsers[1].id,
        addresseeId: seedUsers[2].id,
        status: 'accepted',
        createdAt: offset(-86400000 * 3),
        updatedAt: offset(-86400000 * 3),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(conversations)
    .values([
      {
        id: 'c1',
        type: 'direct',
        title: null,
        avatarUrl: null,
        createdBy: seedUsers[0].id,
        lastMessageAt: offset(-180000),
        createdAt: offset(-86400000 * 2),
      },
      {
        id: 'c2',
        type: 'direct',
        title: null,
        avatarUrl: null,
        createdBy: seedUsers[0].id,
        lastMessageAt: offset(-900000),
        createdAt: offset(-86400000 * 2),
      },
      {
        id: 'c3',
        type: 'group',
        title: 'فريق كونكت الهندسي · Connect Core',
        avatarUrl: null,
        createdBy: seedUsers[0].id,
        lastMessageAt: offset(-3600000),
        createdAt: offset(-86400000 * 3),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(conversationParticipants)
    .values([
      {
        conversationId: 'c1',
        userId: seedUsers[0].id,
        role: 'member',
        joinedAt: offset(-86400000 * 2),
      },
      {
        conversationId: 'c1',
        userId: seedUsers[1].id,
        role: 'member',
        joinedAt: offset(-86400000 * 2),
      },
      {
        conversationId: 'c2',
        userId: seedUsers[0].id,
        role: 'member',
        joinedAt: offset(-86400000 * 2),
      },
      {
        conversationId: 'c2',
        userId: seedUsers[2].id,
        role: 'member',
        joinedAt: offset(-86400000 * 2),
      },
      {
        conversationId: 'c3',
        userId: seedUsers[0].id,
        role: 'admin',
        joinedAt: offset(-86400000 * 3),
      },
      {
        conversationId: 'c3',
        userId: seedUsers[1].id,
        role: 'member',
        joinedAt: offset(-86400000 * 3),
      },
      {
        conversationId: 'c3',
        userId: seedUsers[2].id,
        role: 'member',
        joinedAt: offset(-86400000 * 3),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(messages)
    .values([
      {
        id: 'm1',
        conversationId: 'c1',
        senderId: seedUsers[1].id,
        type: 'text',
        content: 'أهلاً ليلى، تم تفعيل خادم WebRTC STUN/TURN وتجربة إشارة المكالمات بنجاح.',
        mediaUrl: null,
        mediaMeta: null,
        isDeleted: false,
        createdAt: offset(-600000),
      },
      {
        id: 'm2',
        conversationId: 'c1',
        senderId: seedUsers[0].id,
        type: 'text',
        content: 'ممتاز يا طارق! هل نختبر المكالمة الصوتية والمرئية الآن على الجلسة الحية؟',
        mediaUrl: null,
        mediaMeta: null,
        isDeleted: false,
        createdAt: offset(-420000),
      },
      {
        id: 'm3',
        conversationId: 'c1',
        senderId: seedUsers[1].id,
        type: 'text',
        content: 'بالتأكيد، أنا متصل وجاهز لاستقبال المكالمة في أي لحظة.',
        mediaUrl: null,
        mediaMeta: null,
        isDeleted: false,
        createdAt: offset(-180000),
      },
      {
        id: 'm4',
        conversationId: 'c2',
        senderId: seedUsers[2].id,
        type: 'text',
        content: 'راجعت تخطيط الواجهة باللغتين العربية (RTL) والإنجليزية (LTR)، التباين ممتاز.',
        mediaUrl: null,
        mediaMeta: null,
        isDeleted: false,
        createdAt: offset(-1200000),
      },
      {
        id: 'm5',
        conversationId: 'c2',
        senderId: seedUsers[0].id,
        type: 'text',
        content: 'رائع نادية، شكراً على التنسيق الدقيق للخطوط والألوان.',
        mediaUrl: null,
        mediaMeta: null,
        isDeleted: false,
        createdAt: offset(-900000),
      },
      {
        id: 'm6',
        conversationId: 'c3',
        senderId: seedUsers[0].id,
        type: 'text',
        content: 'مرحباً بالجميع في قناة فريق كونكت. نراجع اليوم جاهزية الإطلاق.',
        mediaUrl: null,
        mediaMeta: null,
        isDeleted: false,
        createdAt: offset(-7200000),
      },
      {
        id: 'm7',
        conversationId: 'c3',
        senderId: seedUsers[2].id,
        type: 'text',
        content: 'تم اعتماد شاشات المكالمات الجماعية ولوحة تحكم المشرف.',
        mediaUrl: null,
        mediaMeta: null,
        isDeleted: false,
        createdAt: offset(-5400000),
      },
      {
        id: 'm8',
        conversationId: 'c3',
        senderId: seedUsers[1].id,
        type: 'location',
        content: 'مقر اجتماع الفريق · الرياض',
        mediaUrl: null,
        mediaMeta: JSON.stringify({
          lat: 24.7136,
          lng: 46.6753,
          address: 'حي العليا، الرياض',
        }),
        isDeleted: false,
        createdAt: offset(-3600000),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(messageReads)
    .values([
      { messageId: 'm1', userId: seedUsers[0].id, readAt: offset(-540000) },
      { messageId: 'm2', userId: seedUsers[1].id, readAt: offset(-360000) },
      { messageId: 'm4', userId: seedUsers[0].id, readAt: offset(-1100000) },
      { messageId: 'm6', userId: seedUsers[1].id, readAt: offset(-7100000) },
      { messageId: 'm6', userId: seedUsers[2].id, readAt: offset(-7000000) },
      { messageId: 'm7', userId: seedUsers[0].id, readAt: offset(-5300000) },
    ])
    .onConflictDoNothing();

  await db
    .insert(calls)
    .values([
      {
        id: 'call1',
        conversationId: 'c1',
        callerId: seedUsers[0].id,
        type: 'video',
        status: 'ended',
        startedAt: offset(-3600000 * 4),
        endedAt: offset(-3600000 * 4 + 245000),
      },
      {
        id: 'call2',
        conversationId: 'c2',
        callerId: seedUsers[2].id,
        type: 'audio',
        status: 'missed',
        startedAt: offset(-3600000 * 8),
        endedAt: offset(-3600000 * 8 + 30000),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(callParticipants)
    .values([
      {
        callId: 'call1',
        userId: seedUsers[0].id,
        status: 'joined',
        joinedAt: offset(-3600000 * 4),
        leftAt: offset(-3600000 * 4 + 245000),
      },
      {
        callId: 'call1',
        userId: seedUsers[1].id,
        status: 'joined',
        joinedAt: offset(-3600000 * 4 + 4000),
        leftAt: offset(-3600000 * 4 + 245000),
      },
      {
        callId: 'call2',
        userId: seedUsers[2].id,
        status: 'joined',
        joinedAt: offset(-3600000 * 8),
        leftAt: offset(-3600000 * 8 + 30000),
      },
      {
        callId: 'call2',
        userId: seedUsers[0].id,
        status: 'missed',
        joinedAt: null,
        leftAt: null,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(reports)
    .values([
      {
        id: 'rep1',
        reporterId: seedUsers[2].id,
        reportedUserId: seedUsers[3].id,
        reason: 'رسائل متكررة غير مرغوبة',
        details: 'إرسال طلبات متكررة خارج أوقات العمل للاختبار.',
        status: 'pending',
        createdAt: offset(-3600000 * 3),
      },
    ])
    .onConflictDoNothing();
}

export async function buildUniqueUsername(desired: string, id: string): Promise<string> {
  const candidate = normalizeUsername(desired, id.slice(0, 5));
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, candidate))
    .limit(1);
  if (existing.length === 0) return candidate;
  return normalizeUsername(desired, crypto.randomBytes(3).toString('hex'));
}

// --- Auth & Session Persistence ---

export async function createUserSession(params: {
  userId: string;
  platform?: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  try {
    await ensureInitialized();
    const sessionId = crypto.randomUUID();
    const jti = crypto.randomUUID();
    const tokenHash = hashSessionJti(jti);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14); // 14 days

    await db.insert(sessions).values({
      id: sessionId,
      userId: params.userId,
      tokenHash,
      platform: params.platform || 'web',
      userAgent: params.userAgent?.slice(0, 255) || null,
      ipAddress: params.ipAddress?.slice(0, 64) || null,
      expiresAt,
      revokedAt: null,
    });

    const token = await signSessionJwt({
      userId: params.userId,
      sessionId,
      jti,
    });

    return { token, sessionId, expiresAt };
  } catch (error) {
    console.error('Failed to create session:', error);
    throw new Error('Failed to create authenticated session.', { cause: error });
  }
}

export async function getUserBySessionToken(
  token: string | undefined
): Promise<{ user: UserProfile; sessionId: string } | null> {
  if (!token) return null;
  const decoded = await verifySessionJwt(token);
  if (!decoded) return null;

  try {
    await ensureInitialized();
    const tokenHash = hashSessionJti(decoded.jti);
    const now = new Date();
    const rows = await db
      .select({ user: users, session: sessions })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.id, decoded.sessionId),
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now)
        )
      )
      .limit(1);

    if (rows.length === 0) return null;
    return {
      user: toProfile(rows[0].user),
      sessionId: rows[0].session.id,
    };
  } catch (error) {
    console.error('Session lookup failed:', error);
    return null;
  }
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  try {
    await ensureInitialized();
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  } catch (error) {
    console.error('Failed to revoke session:', error);
    throw new Error('Failed to sign out cleanly.', { cause: error });
  }
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  try {
    await ensureInitialized();
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  } catch (error) {
    console.error('Failed to revoke user sessions:', error);
    throw new Error('Failed to revoke sessions.', { cause: error });
  }
}

export async function registerUserAndIssueOtp(params: {
  email: string;
  password: string;
  fullName: string;
  username?: string;
}): Promise<{ user: UserRow; otp: string; expiresAt: Date; resendAvailableAt: Date }> {
  try {
    await ensureInitialized();
    const cleanEmail = params.email.trim().toLowerCase();

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].emailVerified) {
        throw new AuthDomainError(
          409,
          'EMAIL_EXISTS',
          'An account with this email already exists.'
        );
      }
      // Prevent duplicate unverified account spam: check resend cooldown before updating pending signup
      const recent = await db
        .select()
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.email, cleanEmail),
            eq(emailVerifications.purpose, 'signup'),
            isNull(emailVerifications.usedAt)
          )
        )
        .orderBy(desc(emailVerifications.createdAt))
        .limit(1);

      const now = Date.now();
      if (recent.length > 0 && recent[0].resendAvailableAt.getTime() > now) {
        const retryAfter = Math.ceil((recent[0].resendAvailableAt.getTime() - now) / 1000);
        throw new AuthDomainError(
          429,
          'RESEND_COOLDOWN',
          `Please wait ${retryAfter} seconds before requesting a new verification code.`,
          { retryAfterSeconds: retryAfter }
        );
      }

      const passwordHash = await hashPasswordArgon2(params.password);
      const [updatedUser] = await db
        .update(users)
        .set({
          fullName: params.fullName.trim(),
          passwordHash,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing[0].id))
        .returning();

      const issued = await issueOtpRecord({
        userId: updatedUser.id,
        email: cleanEmail,
        purpose: 'signup',
      });
      return { user: updatedUser, ...issued };
    }

    const userId = crypto.randomUUID();
    const username = await buildUniqueUsername(
      params.username || cleanEmail.split('@')[0],
      userId
    );
    const passwordHash = await hashPasswordArgon2(params.password);

    const [createdUser] = await db
      .insert(users)
      .values({
        id: userId,
        username,
        fullName: params.fullName.trim(),
        email: cleanEmail,
        passwordHash,
        emailVerified: false,
        role: 'user',
        isBanned: false,
        isOnline: false,
      })
      .returning();

    const issued = await issueOtpRecord({
      userId: createdUser.id,
      email: cleanEmail,
      purpose: 'signup',
    });

    return { user: createdUser, ...issued };
  } catch (error) {
    if (error instanceof AuthDomainError) throw error;
    console.error('Signup database error:', error);
    throw new Error('Unable to register account right now.', { cause: error });
  }
}

export async function issueOtpRecord(params: {
  userId?: string | null;
  email: string;
  purpose: 'signup' | 'reset_password';
}): Promise<{ otp: string; expiresAt: Date; resendAvailableAt: Date }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const now = new Date();

  const existing = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.email, cleanEmail),
        eq(emailVerifications.purpose, params.purpose),
        isNull(emailVerifications.usedAt)
      )
    )
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);

  if (existing.length > 0 && existing[0].resendAvailableAt.getTime() > now.getTime()) {
    const retryAfter = Math.ceil(
      (existing[0].resendAvailableAt.getTime() - now.getTime()) / 1000
    );
    throw new AuthDomainError(
      429,
      'RESEND_COOLDOWN',
      `Please wait ${retryAfter} seconds before requesting a new code.`,
      { retryAfterSeconds: retryAfter }
    );
  }

  // Invalidate previous active OTPs for same email + purpose
  await db
    .update(emailVerifications)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailVerifications.email, cleanEmail),
        eq(emailVerifications.purpose, params.purpose),
        isNull(emailVerifications.usedAt)
      )
    );

  const verificationId = crypto.randomUUID();
  const otp = generateNumericOtp();
  const otpHash = hashOtpCode(verificationId, otp);
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes
  const resendAvailableAt = new Date(now.getTime() + 30 * 1000); // 30 seconds

  await db.insert(emailVerifications).values({
    id: verificationId,
    userId: params.userId ?? null,
    email: cleanEmail,
    purpose: params.purpose,
    otpHash,
    expiresAt,
    resendAvailableAt,
    attempts: 0,
    maxAttempts: 5,
    usedAt: null,
  });

  return { otp, expiresAt, resendAvailableAt };
}

export async function verifyAndConsumeOtp(params: {
  email: string;
  otp: string;
  purpose: 'signup' | 'reset_password';
}): Promise<UserRow> {
  try {
    await ensureInitialized();
    const cleanEmail = params.email.trim().toLowerCase();
    const cleanOtp = params.otp.replace(/\s+/g, '');
    const now = new Date();

    const records = await db
      .select()
      .from(emailVerifications)
      .where(
        and(
          eq(emailVerifications.email, cleanEmail),
          eq(emailVerifications.purpose, params.purpose),
          isNull(emailVerifications.usedAt)
        )
      )
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);

    if (records.length === 0) {
      throw new AuthDomainError(
        400,
        'OTP_NOT_FOUND',
        'No active verification code found. Please request a new code.'
      );
    }

    const record = records[0];

    if (record.expiresAt.getTime() <= now.getTime()) {
      await db
        .update(emailVerifications)
        .set({ usedAt: now })
        .where(eq(emailVerifications.id, record.id));
      throw new AuthDomainError(
        400,
        'OTP_EXPIRED',
        'Verification code has expired (valid for 5 minutes). Please request a new code.'
      );
    }

    if (record.attempts >= record.maxAttempts) {
      await db
        .update(emailVerifications)
        .set({ usedAt: now })
        .where(eq(emailVerifications.id, record.id));
      throw new AuthDomainError(
        429,
        'OTP_MAX_ATTEMPTS',
        'Maximum verification attempts exceeded. Please request a new code.'
      );
    }

    const isMatch = verifyOtpHash(record.id, cleanOtp, record.otpHash);
    if (!isMatch) {
      const nextAttempts = record.attempts + 1;
      const exhausted = nextAttempts >= record.maxAttempts;
      await db
        .update(emailVerifications)
        .set({
          attempts: nextAttempts,
          usedAt: exhausted ? now : null,
        })
        .where(eq(emailVerifications.id, record.id));

      const remaining = Math.max(0, record.maxAttempts - nextAttempts);
      throw new AuthDomainError(
        exhausted ? 429 : 400,
        exhausted ? 'OTP_MAX_ATTEMPTS' : 'OTP_INVALID',
        exhausted
          ? 'Too many incorrect attempts. Please request a new verification code.'
          : `Invalid verification code. ${remaining} attempt(s) remaining.`,
        { remainingAttempts: remaining }
      );
    }

    // Single-use: mark consumed atomically
    const consumed = await db
      .update(emailVerifications)
      .set({ usedAt: now })
      .where(
        and(eq(emailVerifications.id, record.id), isNull(emailVerifications.usedAt))
      )
      .returning();

    if (consumed.length === 0) {
      throw new AuthDomainError(
        400,
        'OTP_ALREADY_USED',
        'This verification code has already been used.'
      );
    }

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (userRows.length === 0) {
      throw new AuthDomainError(404, 'USER_NOT_FOUND', 'Account not found.');
    }

    if (params.purpose === 'signup' && !userRows[0].emailVerified) {
      const [verifiedUser] = await db
        .update(users)
        .set({ emailVerified: true, updatedAt: now })
        .where(eq(users.id, userRows[0].id))
        .returning();
      return verifiedUser;
    }

    return userRows[0];
  } catch (error) {
    if (error instanceof AuthDomainError) throw error;
    console.error('OTP verification failed:', error);
    throw new Error('Failed to verify code.', { cause: error });
  }
}

export async function authenticateWithPassword(
  email: string,
  password: string
): Promise<UserProfile> {
  try {
    await ensureInitialized();
    const cleanEmail = email.trim().toLowerCase();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (rows.length === 0) {
      throw new AuthDomainError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const userRow = rows[0];
    const now = new Date();

    if (userRow.lockedUntil && userRow.lockedUntil.getTime() > now.getTime()) {
      const minutes = Math.ceil((userRow.lockedUntil.getTime() - now.getTime()) / 60000);
      throw new AuthDomainError(
        429,
        'ACCOUNT_LOCKED',
        `Account temporarily locked due to failed attempts. Try again in ${minutes} minute(s).`
      );
    }

    if (!userRow.passwordHash) {
      throw new AuthDomainError(
        401,
        'OAUTH_ONLY_ACCOUNT',
        'This account uses Google or Apple sign-in. Sign in with your provider or reset your password.'
      );
    }

    const { valid, needsRehash } = await verifyPasswordHash(
      password,
      userRow.passwordHash
    );
    if (!valid) {
      const nextFails = (userRow.failedLoginAttempts || 0) + 1;
      const shouldLock = nextFails >= 5;
      await db
        .update(users)
        .set({
          failedLoginAttempts: shouldLock ? 0 : nextFails,
          lockedUntil: shouldLock ? new Date(now.getTime() + 15 * 60 * 1000) : null,
          updatedAt: now,
        })
        .where(eq(users.id, userRow.id));

      throw new AuthDomainError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    if (!userRow.emailVerified) {
      throw new AuthDomainError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address with the 6-digit code before signing in.',
        { email: cleanEmail }
      );
    }

    if (userRow.isBanned) {
      throw new AuthDomainError(
        403,
        'ACCOUNT_BANNED',
        'Account is suspended by an administrator.'
      );
    }

    const updateFields: Partial<typeof users.$inferInsert> = {
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: now,
    };
    if (needsRehash) {
      updateFields.passwordHash = await hashPasswordArgon2(password);
    }

    const [cleanUser] = await db
      .update(users)
      .set(updateFields)
      .where(eq(users.id, userRow.id))
      .returning();

    return toProfile(cleanUser);
  } catch (error) {
    if (error instanceof AuthDomainError) throw error;
    console.error('Login failed:', error);
    throw new Error('Authentication failed. Please try again later.', { cause: error });
  }
}

export async function initiatePasswordReset(email: string): Promise<{
  sent: boolean;
  user?: UserRow;
  otp?: string;
}> {
  try {
    await ensureInitialized();
    const cleanEmail = email.trim().toLowerCase();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (rows.length === 0) {
      return { sent: false };
    }

    const issued = await issueOtpRecord({
      userId: rows[0].id,
      email: cleanEmail,
      purpose: 'reset_password',
    });

    return { sent: true, user: rows[0], otp: issued.otp };
  } catch (error) {
    if (error instanceof AuthDomainError) throw error;
    console.error('Password reset initiation error:', error);
    throw new Error('Unable to process password reset request.', { cause: error });
  }
}

export async function completePasswordReset(params: {
  email: string;
  otp: string;
  newPassword: string;
}): Promise<void> {
  const userRow = await verifyAndConsumeOtp({
    email: params.email,
    otp: params.otp,
    purpose: 'reset_password',
  });

  const passwordHash = await hashPasswordArgon2(params.newPassword);
  const now = new Date();

  await db
    .update(users)
    .set({
      passwordHash,
      emailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(users.id, userRow.id));

  await revokeAllSessionsForUser(userRow.id);
}

export async function upsertOAuthUser(
  profile: VerifiedOAuthProfile
): Promise<UserProfile> {
  try {
    await ensureInitialized();
    const now = new Date();
    const cleanEmail = profile.email ? profile.email.trim().toLowerCase() : null;

    // Resolve safe uid assignment only if not already claimed by a different user row
    async function resolveSafeUid(
      candidateUid: string | undefined,
      targetUserId?: string
    ): Promise<string | null> {
      if (!candidateUid) return null;
      const owner = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.uid, candidateUid))
        .limit(1);
      if (owner.length === 0) return candidateUid;
      if (targetUserId && owner[0].id === targetUserId) return candidateUid;
      return null;
    }

    // 1. Check existing linked OAuth account first (essential for Apple repeat logins where email may be omitted)
    const linked = await db
      .select({ user: users, oauth: oauthAccounts })
      .from(oauthAccounts)
      .innerJoin(users, eq(oauthAccounts.userId, users.id))
      .where(
        and(
          eq(oauthAccounts.provider, profile.provider),
          eq(oauthAccounts.providerAccountId, profile.providerAccountId)
        )
      )
      .limit(1);

    if (linked.length > 0) {
      const existingUser = linked[0].user;
      if (existingUser.isBanned) {
        throw new AuthDomainError(
          403,
          'ACCOUNT_BANNED',
          'Account is suspended by an administrator.'
        );
      }

      const safeUid =
        existingUser.uid || (await resolveSafeUid(profile.uid, existingUser.id));

      const [updated] = await db
        .update(users)
        .set({
          uid: safeUid,
          avatarUrl: existingUser.avatarUrl || profile.avatarUrl,
          emailVerified: existingUser.emailVerified || profile.emailVerified,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(users.id, existingUser.id))
        .returning();

      return toProfile(updated);
    }

    // 2. Match existing account by email first so we never hit uq_users_email constraint crashes
    let userRow: UserRow | null = null;
    if (cleanEmail) {
      const byEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, cleanEmail))
        .limit(1);
      if (byEmail.length > 0) {
        if (!profile.emailVerified) {
          throw new AuthDomainError(
            403,
            'EMAIL_NOT_VERIFIED',
            'Your provider email must be verified before linking to an existing account.'
          );
        }
        userRow = byEmail[0];
        if (userRow.isBanned) {
          throw new AuthDomainError(
            403,
            'ACCOUNT_BANNED',
            'Account is suspended by an administrator.'
          );
        }
        const safeUid =
          userRow.uid || (await resolveSafeUid(profile.uid, userRow.id));

        const [updated] = await db
          .update(users)
          .set({
            uid: safeUid,
            emailVerified: true,
            failedLoginAttempts: 0,
            lockedUntil: null,
            avatarUrl: userRow.avatarUrl || profile.avatarUrl,
            updatedAt: now,
          })
          .where(eq(users.id, userRow.id))
          .returning();
        userRow = updated;
      }
    }

    // 3. Create new user if none found
    if (!userRow) {
      if (!cleanEmail) {
        throw new AuthDomainError(
          400,
          'OAUTH_EMAIL_MISSING',
          'Email permission is required on initial sign-in.'
        );
      }
      const userId = crypto.randomUUID();
      const baseName =
        profile.fullName?.trim() || cleanEmail.split('@')[0] || 'Connect User';
      const username = await buildUniqueUsername(
        profile.isPrivateRelay ? baseName : cleanEmail.split('@')[0],
        userId
      );
      const safeUid = await resolveSafeUid(profile.uid);

      const [created] = await db
        .insert(users)
        .values({
          id: userId,
          uid: safeUid,
          username,
          fullName: baseName,
          email: cleanEmail,
          passwordHash: null,
          emailVerified: profile.emailVerified,
          avatarUrl: profile.avatarUrl,
          role: 'user',
          isBanned: false,
          isOnline: false,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      userRow = created;
    }

    // 4. Persist oauth_accounts link safely with upsert
    await db
      .insert(oauthAccounts)
      .values({
        id: crypto.randomUUID(),
        userId: userRow.id,
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
        email: cleanEmail,
        isPrivateRelay: profile.isPrivateRelay,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
        set: {
          userId: userRow.id,
          email: cleanEmail,
          isPrivateRelay: profile.isPrivateRelay,
          updatedAt: now,
        },
      });

    return toProfile(userRow);
  } catch (error) {
    if (error instanceof AuthDomainError) throw error;
    console.error('OAuth user sync failed:', error);
    throw new Error('Failed to authenticate with external provider.', { cause: error });
  }
}

export async function deleteUserAccount(userId: string): Promise<void> {
  try {
    await ensureInitialized();
    await db.delete(users).where(eq(users.id, userId));
  } catch (error) {
    console.error('Failed to delete account:', error);
    throw new Error('Unable to delete account right now.', { cause: error });
  }
}

export async function getUserById(userId: string): Promise<UserProfile | null> {
  try {
    await ensureInitialized();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows.length > 0 ? toProfile(rows[0]) : null;
  } catch (error) {
    console.error('getUserById error:', error);
    return null;
  }
}

export async function updateUserPresence(
  userId: string,
  isOnline: boolean
): Promise<void> {
  try {
    await ensureInitialized();
    await db
      .update(users)
      .set({ isOnline, lastSeenAt: new Date() })
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('Presence update failed:', error);
  }
}

export async function updateUserProfile(
  userId: string,
  patch: {
    full_name?: string;
    username?: string;
    bio?: string;
    avatar_url?: string | null;
  }
): Promise<UserProfile> {
  try {
    await ensureInitialized();
    const currentRows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (currentRows.length === 0) {
      throw new AuthDomainError(404, 'NOT_FOUND', 'User not found.');
    }
    const current = currentRows[0];

    let nextUsername = current.username;
    if (typeof patch.username === 'string' && patch.username.trim().length >= 3) {
      const candidate = patch.username
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');
      const conflict = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, candidate), ne(users.id, userId)))
        .limit(1);
      if (conflict.length > 0) {
        throw new AuthDomainError(
          409,
          'USERNAME_TAKEN',
          'Username is already taken.'
        );
      }
      nextUsername = candidate;
    }

    const nextName =
      typeof patch.full_name === 'string' && patch.full_name.trim().length >= 2
        ? patch.full_name.trim()
        : current.fullName;
    const nextBio =
      typeof patch.bio === 'string' ? patch.bio.trim().slice(0, 240) : current.bio;
    const nextAvatar =
      patch.avatar_url === undefined ? current.avatarUrl : patch.avatar_url;

    const [updated] = await db
      .update(users)
      .set({
        fullName: nextName,
        username: nextUsername,
        bio: nextBio,
        avatarUrl: nextAvatar,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return toProfile(updated);
  } catch (error) {
    if (error instanceof AuthDomainError) throw error;
    console.error('Failed to update profile:', error);
    throw new Error('Failed to update profile.', { cause: error });
  }
}

export async function getUserRowByEmail(email: string): Promise<UserRow | null> {
  await ensureInitialized();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] || null;
}

// --- Workspace Helpers (Settings, Friendships, Conversations, Messages, Calls, Admin) ---

export async function getAppSettings(): Promise<AppSettings> {
  try {
    await ensureInitialized();
    const rows = await db.select().from(appSettings);
    const settings: AppSettings = {
      maintenance_mode: { enabled: false, message_ar: '', message_en: '' },
      calls_enabled: { audio: true, video: true, max_group_participants: 8 },
    };
    for (const r of rows) {
      try {
        if (r.key === 'maintenance_mode') settings.maintenance_mode = JSON.parse(r.value);
        if (r.key === 'calls_enabled') settings.calls_enabled = JSON.parse(r.value);
      } catch {
        // ignore malformed json
      }
    }
    return settings;
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return {
      maintenance_mode: { enabled: false, message_ar: '', message_en: '' },
      calls_enabled: { audio: true, video: true, max_group_participants: 8 },
    };
  }
}

export async function updateAppSetting(
  key: 'maintenance_mode' | 'calls_enabled',
  value: unknown
): Promise<AppSettings> {
  await ensureInitialized();
  const now = new Date();
  await db
    .insert(appSettings)
    .values({ key, value: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(value), updatedAt: now },
    });
  return getAppSettings();
}

export async function searchUsers(
  currentUserId: string,
  query: string
): Promise<UserProfile[]> {
  await ensureInitialized();
  const q = query.trim().toLowerCase();
  const rows = await db
    .select()
    .from(users)
    .where(and(ne(users.id, currentUserId), eq(users.isBanned, false)))
    .orderBy(asc(users.fullName))
    .limit(60);

  return rows
    .map(toProfile)
    .filter(
      (u) =>
        !q ||
        u.username.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q)
    );
}

export async function isConversationMember(
  conversationId: string,
  userId: string
): Promise<boolean> {
  await ensureInitialized();
  const rows = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function isCallParticipant(
  callId: string,
  userId: string
): Promise<boolean> {
  await ensureInitialized();
  const asCaller = await db
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.callerId, userId)))
    .limit(1);
  if (asCaller.length > 0) return true;

  const asParticipant = await db
    .select({ userId: callParticipants.userId })
    .from(callParticipants)
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, userId)))
    .limit(1);
  return asParticipant.length > 0;
}

export async function isBlockedBetween(u1: string, u2: string): Promise<boolean> {
  await ensureInitialized();
  const rows = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'blocked'),
        or(
          and(eq(friendships.requesterId, u1), eq(friendships.addresseeId, u2)),
          and(eq(friendships.requesterId, u2), eq(friendships.addresseeId, u1))
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function getConversationParticipants(
  conversationId: string
): Promise<UserProfile[]> {
  await ensureInitialized();
  const rows = await db
    .select({ user: users })
    .from(conversationParticipants)
    .innerJoin(users, eq(conversationParticipants.userId, users.id))
    .where(eq(conversationParticipants.conversationId, conversationId))
    .orderBy(asc(conversationParticipants.joinedAt));
  return rows.map((r) => toProfile(r.user));
}

export async function getMessagesForConversation(
  conversationId: string
): Promise<Message[]> {
  await ensureInitialized();
  const msgRows = await db
    .select({ message: messages, sender: users })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  if (msgRows.length === 0) return [];

  const msgIds = msgRows.map((m) => m.message.id);
  const readRows = await db
    .select()
    .from(messageReads)
    .where(inArray(messageReads.messageId, msgIds));

  const readsMap = new Map<string, MessageRead[]>();
  for (const r of readRows) {
    const list = readsMap.get(r.messageId) || [];
    list.push({
      message_id: r.messageId,
      user_id: r.userId,
      read_at: r.readAt.toISOString(),
    });
    readsMap.set(r.messageId, list);
  }

  return msgRows.map(({ message: m, sender }) => ({
    id: m.id,
    conversation_id: m.conversationId,
    sender_id: m.senderId,
    type: m.type as Message['type'],
    content: m.isDeleted ? '' : m.content,
    media_url: m.isDeleted ? null : m.mediaUrl ?? null,
    media_meta:
      !m.isDeleted && m.mediaMeta ? JSON.parse(m.mediaMeta) : null,
    is_deleted: Boolean(m.isDeleted),
    created_at: m.createdAt.toISOString(),
    sender: toProfile(sender),
    reads: readsMap.get(m.id) || [],
  }));
}

export async function getUserConversations(userId: string): Promise<Conversation[]> {
  await ensureInitialized();
  const convRows = await db
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversationId, conversations.id)
    )
    .where(eq(conversationParticipants.userId, userId))
    .orderBy(desc(conversations.lastMessageAt));

  const results: Conversation[] = [];
  for (const { conversation: c } of convRows) {
    const participants = await getConversationParticipants(c.id);
    const msgs = await getMessagesForConversation(c.id);
    const allReads = msgs.flatMap((m) => m.reads || []);
    const unread_count = computeUnreadCount(msgs, allReads, userId);
    const last_message = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const other =
      c.type === 'direct' ? participants.find((p) => p.id !== userId) : null;
    const is_blocked = other ? await isBlockedBetween(userId, other.id) : false;

    results.push({
      id: c.id,
      type: c.type === 'group' ? 'group' : 'direct',
      title: c.title ?? null,
      avatar_url: c.avatarUrl ?? null,
      created_by: c.createdBy,
      last_message_at: c.lastMessageAt.toISOString(),
      created_at: c.createdAt.toISOString(),
      participants,
      last_message,
      unread_count,
      is_blocked,
    });
  }
  return results;
}

export async function createOrFindConversation(params: {
  userId: string;
  type: 'direct' | 'group';
  participantIds: string[];
  title?: string;
}): Promise<Conversation> {
  await ensureInitialized();
  const uniquePeers = Array.from(
    new Set(params.participantIds.filter((id) => id && id !== params.userId))
  );

  if (params.type !== 'group') {
    if (uniquePeers.length !== 1) {
      throw new AuthDomainError(
        400,
        'INVALID_PEER',
        'Direct conversation requires exactly 1 peer'
      );
    }
    const peerId = uniquePeers[0];
    if (await isBlockedBetween(params.userId, peerId)) {
      throw new AuthDomainError(
        403,
        'BLOCKED',
        'Communication is blocked between users.'
      );
    }

    // Find existing direct conversation containing both participants
    const myDirect = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(
        conversationParticipants,
        eq(conversationParticipants.conversationId, conversations.id)
      )
      .where(
        and(
          eq(conversations.type, 'direct'),
          eq(conversationParticipants.userId, params.userId)
        )
      );

    if (myDirect.length > 0) {
      const candidateIds = myDirect.map((c) => c.id);
      const shared = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(
          and(
            inArray(conversationParticipants.conversationId, candidateIds),
            eq(conversationParticipants.userId, peerId)
          )
        )
        .limit(1);

      if (shared.length > 0) {
        const convs = await getUserConversations(params.userId);
        const found = convs.find((c) => c.id === shared[0].conversationId);
        if (found) return found;
      }
    }

    const convId = crypto.randomUUID();
    const now = new Date();
    await db.insert(conversations).values({
      id: convId,
      type: 'direct',
      title: null,
      avatarUrl: null,
      createdBy: params.userId,
      lastMessageAt: now,
      createdAt: now,
    });
    await db.insert(conversationParticipants).values([
      { conversationId: convId, userId: params.userId, role: 'member', joinedAt: now },
      { conversationId: convId, userId: peerId, role: 'member', joinedAt: now },
    ]);

    const convs = await getUserConversations(params.userId);
    return convs.find((c) => c.id === convId)!;
  }

  if (!params.title || params.title.trim().length < 2) {
    throw new AuthDomainError(400, 'INVALID_TITLE', 'Group title is required');
  }
  if (uniquePeers.length < 1) {
    throw new AuthDomainError(
      400,
      'INVALID_MEMBERS',
      'Select at least 1 group member'
    );
  }

  const convId = crypto.randomUUID();
  const now = new Date();
  await db.insert(conversations).values({
    id: convId,
    type: 'group',
    title: params.title.trim(),
    avatarUrl: null,
    createdBy: params.userId,
    lastMessageAt: now,
    createdAt: now,
  });
  await db.insert(conversationParticipants).values([
    { conversationId: convId, userId: params.userId, role: 'admin', joinedAt: now },
    ...uniquePeers.map((pid) => ({
      conversationId: convId,
      userId: pid,
      role: 'member',
      joinedAt: now,
    })),
  ]);

  const convs = await getUserConversations(params.userId);
  return convs.find((c) => c.id === convId)!;
}

export async function createMessageRecord(params: {
  conversationId: string;
  senderId: string;
  type: 'text' | 'image' | 'audio' | 'location';
  content: string;
  mediaUrl: string | null;
  mediaMeta: Record<string, unknown> | null;
}): Promise<Message> {
  await ensureInitialized();
  const msgId = crypto.randomUUID();
  const now = new Date();

  await db.insert(messages).values({
    id: msgId,
    conversationId: params.conversationId,
    senderId: params.senderId,
    type: params.type,
    content: params.content,
    mediaUrl: params.mediaUrl,
    mediaMeta: params.mediaMeta ? JSON.stringify(params.mediaMeta) : null,
    isDeleted: false,
    createdAt: now,
  });

  await db
    .update(conversations)
    .set({ lastMessageAt: now })
    .where(eq(conversations.id, params.conversationId));

  const all = await getMessagesForConversation(params.conversationId);
  return all.find((m) => m.id === msgId)!;
}

export async function markConversationMessagesRead(
  conversationId: string,
  userId: string
): Promise<{ messageIds: string[]; readAt: string }> {
  await ensureInitialized();
  const now = new Date();
  const convMessages = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        ne(messages.senderId, userId),
        eq(messages.isDeleted, false)
      )
    );

  if (convMessages.length === 0) {
    return { messageIds: [], readAt: now.toISOString() };
  }

  const existingReads = await db
    .select({ messageId: messageReads.messageId })
    .from(messageReads)
    .where(
      and(
        eq(messageReads.userId, userId),
        inArray(
          messageReads.messageId,
          convMessages.map((m) => m.id)
        )
      )
    );

  const alreadySet = new Set(existingReads.map((r) => r.messageId));
  const unreadIds = convMessages
    .map((m) => m.id)
    .filter((id) => !alreadySet.has(id));

  if (unreadIds.length > 0) {
    await db
      .insert(messageReads)
      .values(unreadIds.map((messageId) => ({ messageId, userId, readAt: now })))
      .onConflictDoNothing();
  }

  return { messageIds: unreadIds, readAt: now.toISOString() };
}

export async function getUserFriendships(userId: string): Promise<Friendship[]> {
  await ensureInitialized();
  const rows = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)))
    .orderBy(desc(friendships.updatedAt));

  if (rows.length === 0) return [];
  const otherIds = Array.from(
    new Set(rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId)))
  );
  const otherUsers = await db
    .select()
    .from(users)
    .where(inArray(users.id, otherIds));
  const userMap = new Map(otherUsers.map((u) => [u.id, toProfile(u)]));

  const results: Friendship[] = [];
  for (const r of rows) {
    const otherId = r.requesterId === userId ? r.addresseeId : r.requesterId;
    const otherProfile = userMap.get(otherId);
    if (!otherProfile) continue;
    results.push({
      id: r.id,
      requester_id: r.requesterId,
      addressee_id: r.addresseeId,
      status: r.status as Friendship['status'],
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      other_user: otherProfile,
      direction: r.requesterId === userId ? 'outgoing' : 'incoming',
    });
  }
  return results;
}

export async function getUserCalls(userId: string): Promise<CallRecord[]> {
  await ensureInitialized();
  const callerCalls = await db
    .select({ id: calls.id })
    .from(calls)
    .where(eq(calls.callerId, userId));
  const partCalls = await db
    .select({ id: callParticipants.callId })
    .from(callParticipants)
    .where(eq(callParticipants.userId, userId));

  const callIds = Array.from(
    new Set([...callerCalls.map((c) => c.id), ...partCalls.map((c) => c.id)])
  );
  if (callIds.length === 0) return [];

  const callRows = await db
    .select({ call: calls, convTitle: conversations.title })
    .from(calls)
    .innerJoin(conversations, eq(conversations.id, calls.conversationId))
    .where(inArray(calls.id, callIds))
    .orderBy(desc(calls.startedAt))
    .limit(50);

  const enriched: CallRecord[] = [];
  for (const row of callRows) {
    enriched.push(await enrichCallRecord(row.call, row.convTitle));
  }
  return enriched;
}

export async function enrichCallRecord(
  c: typeof calls.$inferSelect,
  conversationTitle?: string | null
): Promise<CallRecord> {
  const callerRows = await db
    .select()
    .from(users)
    .where(eq(users.id, c.callerId))
    .limit(1);
  const partRows = await db
    .select({ part: callParticipants, user: users })
    .from(callParticipants)
    .innerJoin(users, eq(callParticipants.userId, users.id))
    .where(eq(callParticipants.callId, c.id));

  let resolvedTitle = conversationTitle;
  if (resolvedTitle === undefined) {
    const convRows = await db
      .select({ title: conversations.title })
      .from(conversations)
      .where(eq(conversations.id, c.conversationId))
      .limit(1);
    resolvedTitle = convRows[0]?.title ?? null;
  }

  const participants: CallParticipant[] = partRows.map(({ part, user }) => ({
    call_id: part.callId,
    user_id: part.userId,
    status: part.status as CallParticipant['status'],
    joined_at: part.joinedAt ? part.joinedAt.toISOString() : null,
    left_at: part.leftAt ? part.leftAt.toISOString() : null,
    user: toProfile(user),
  }));

  return {
    id: c.id,
    conversation_id: c.conversationId,
    caller_id: c.callerId,
    type: c.type === 'video' ? 'video' : 'audio',
    status: c.status as CallRecord['status'],
    started_at: c.startedAt.toISOString(),
    ended_at: c.endedAt ? c.endedAt.toISOString() : null,
    caller: callerRows[0] ? toProfile(callerRows[0]) : undefined,
    conversation_title: resolvedTitle ?? null,
    participants,
  };
}

export async function getAllReports(): Promise<ReportRecord[]> {
  await ensureInitialized();
  const rows = await db
    .select()
    .from(reports)
    .orderBy(desc(reports.createdAt));

  if (rows.length === 0) return [];
  const ids = Array.from(
    new Set(rows.flatMap((r) => [r.reporterId, r.reportedUserId]))
  );
  const userRows = await db.select().from(users).where(inArray(users.id, ids));
  const userMap = new Map(userRows.map((u) => [u.id, toProfile(u)]));

  return rows.map((r) => ({
    id: r.id,
    reporter_id: r.reporterId,
    reported_user_id: r.reportedUserId,
    reason: r.reason,
    details: r.details ?? null,
    status: r.status as ReportStatus,
    created_at: r.createdAt.toISOString(),
    reporter: userMap.get(r.reporterId),
    reported_user: userMap.get(r.reportedUserId),
  }));
}

export async function getAdminOverviewData() {
  await ensureInitialized();
  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
  const allReports = await getAllReports();
  const settings = await getAppSettings();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(calls);

  return {
    users: allUsers.map(toProfile),
    reports: allReports,
    settings,
    callCount: Number(count || 0),
  };
}
