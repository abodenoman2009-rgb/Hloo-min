import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from './src/db/index.ts';
import {
  callParticipants,
  calls,
  friendships,
  messages,
  reports,
  sessions,
  users,
} from './src/db/schema.ts';
import { canInitiateCall } from './src/lib/connectLogic.ts';
import type { SignalPayload, UserProfile } from './src/types.ts';
import {
  AppleNotConfiguredError,
  InvalidOAuthTokenError,
  verifyAppleIdentityToken,
  verifyGoogleCredential,
} from './server/authCrypto.ts';
import { isSmtpConfigured, sendVerificationOtpEmail, SmtpNotConfiguredError } from './server/email.ts';
import {
  AuthDomainError,
  authenticateWithPassword,
  completePasswordReset,
  createMessageRecord,
  createOrFindConversation,
  createUserSession,
  deleteUserAccount,
  enrichCallRecord,
  ensureInitialized,
  getAdminOverviewData,
  getAllReports,
  getAppSettings,
  getConversationParticipants,
  getMessagesForConversation,
  getUserById,
  getUserBySessionToken,
  getUserCalls,
  getUserConversations,
  getUserFriendships,
  getUserRowByEmail,
  initiatePasswordReset,
  isBlockedBetween,
  isCallParticipant,
  isConversationMember,
  issueOtpRecord,
  markConversationMessagesRead,
  registerUserAndIssueOtp,
  revokeSessionById,
  searchUsers,
  toProfile,
  updateAppSetting,
  updateUserPresence,
  updateUserProfile,
  uploadsDir,
  upsertOAuthUser,
  verifyAndConsumeOtp,
} from './server/pgStore.ts';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/uploads', express.static(uploadsDir));

// Safe security headers without X-Frame-Options (AI Studio preview runs in cross-origin iframe)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const SESSION_COOKIE_NAME = 'connect_session';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function setSessionCookie(res: Response, token: string): void {
  const maxAge = 60 * 60 * 24 * 14; // 14 days
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}

function getAppBaseUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured && configured !== 'MY_APP_URL') {
    return configured.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

function isOriginValidForCookieMutation(req: Request): boolean {
  if (req.headers['x-requested-with']) return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return Boolean(reqHost && originHost === reqHost);
  } catch {
    return false;
  }
}

function sendErrorResponse(res: Response, err: unknown, fallbackMessage: string): void {
  if (err instanceof AuthDomainError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.extra || {}),
    });
    return;
  }
  if (err instanceof InvalidOAuthTokenError) {
    res.status(401).json({
      error: err.message,
      code: 'INVALID_OAUTH_TOKEN',
    });
    return;
  }
  if (err instanceof AppleNotConfiguredError) {
    res.status(503).json({
      error: err.message,
      code: 'APPLE_NOT_CONFIGURED',
    });
    return;
  }
  if (err instanceof SmtpNotConfiguredError) {
    res.status(503).json({
      error: err.message,
      code: 'SMTP_NOT_CONFIGURED',
    });
    return;
  }
  const msg = err instanceof Error ? err.message : fallbackMessage;
  res.status(500).json({ error: msg || fallbackMessage });
}

interface AuthedRequest extends Request {
  user?: UserProfile;
  authToken?: string;
  sessionId?: string;
}

// Rate limiters protecting auth & OTP routes against brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
  },
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many verification code requests. Please wait before trying again.',
    code: 'RATE_LIMITED',
  },
});

const clientsByUser = new Map<string, Set<WebSocket>>();

function sendToUser(userId: string, event: string, payload: unknown): void {
  const sockets = clientsByUser.get(userId);
  if (!sockets) return;
  const serialized = JSON.stringify({ event, payload });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function broadcastAll(event: string, payload: unknown): void {
  const serialized = JSON.stringify({ event, payload });
  for (const sockets of clientsByUser.values()) {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  }
}

async function broadcastToConversation(
  conversationId: string,
  event: string,
  payload: unknown
): Promise<void> {
  const members = await getConversationParticipants(conversationId);
  for (const m of members) {
    sendToUser(m.id, event, payload);
  }
}

async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || '';
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME] || '';

  const token = bearerToken || cookieToken;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // CSRF check when relying on cookie for state-changing requests
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
  if (!bearerToken && cookieToken && isMutating && !isOriginValidForCookieMutation(req)) {
    res.status(403).json({ error: 'Invalid request origin.' });
    return;
  }

  const sessionData = await getUserBySessionToken(token);
  if (!sessionData) {
    if (!bearerToken && cookieToken) {
      clearSessionCookie(res);
    }
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (sessionData.user.is_banned) {
    res.status(403).json({ error: 'Account is suspended by an administrator.' });
    return;
  }

  req.user = sessionData.user;
  req.authToken = token;
  req.sessionId = sessionData.sessionId;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Administrator privileges required.' });
    return;
  }
  next();
}

function detectPlatform(req: Request, bodyPlatform?: string): string {
  if (bodyPlatform === 'ios' || bodyPlatform === 'android' || bodyPlatform === 'web') {
    return bodyPlatform;
  }
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('cfnetwork')) {
    return 'ios';
  }
  if (ua.includes('android')) {
    return 'android';
  }
  return 'web';
}

// --- Public Authentication & OAuth Endpoints ---

app.get('/api/auth/session', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const bearerToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[SESSION_COOKIE_NAME] || '';
    const token = bearerToken || cookieToken;
    if (!token) {
      res.json({ authenticated: false });
      return;
    }
    const sessionData = await getUserBySessionToken(token);
    if (!sessionData || sessionData.user.is_banned) {
      if (!bearerToken && cookieToken) clearSessionCookie(res);
      res.json({ authenticated: false });
      return;
    }
    const settings = await getAppSettings();
    res.json({
      authenticated: true,
      user: sessionData.user,
      settings,
      wsToken: token,
    });
  } catch {
    res.json({ authenticated: false });
  }
});

app.get('/api/auth/providers', (_req, res) => {
  res.json({
    googleEnabled: true,
    appleWebEnabled: Boolean(process.env.APPLE_SERVICE_ID?.trim()),
    appleNativeSupported: true,
    smtpConfigured: isSmtpConfigured(),
  });
});

app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { email, password, confirmPassword, fullName, username } = req.body as {
      email?: string;
      password?: string;
      confirmPassword?: string;
      fullName?: string;
      username?: string;
    };

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Valid email is required.' });
      return;
    }
    if (!fullName || fullName.trim().length < 2) {
      res.status(400).json({ error: 'Full name must be at least 2 characters.' });
      return;
    }
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    const { user, otp } = await registerUserAndIssueOtp({
      email: cleanEmail,
      password,
      fullName,
      username,
    });

    await sendVerificationOtpEmail({
      to: user.email,
      fullName: user.fullName,
      otp,
      purpose: 'signup',
    });

    res.status(201).json({
      verificationRequired: true,
      email: user.email,
      expiresInSeconds: 300,
      resendCooldownSeconds: 30,
    });
  } catch (err) {
    sendErrorResponse(res, err, 'Signup failed.');
  }
});

app.post('/api/auth/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { email, otp, platform } = req.body as {
      email?: string;
      otp?: string;
      platform?: string;
    };
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanOtp = (otp || '').replace(/\s+/g, '');
    if (!cleanEmail || !/^\d{6}$/.test(cleanOtp)) {
      res.status(400).json({ error: 'Valid email and 6-digit code are required.' });
      return;
    }

    const userRow = await verifyAndConsumeOtp({
      email: cleanEmail,
      otp: cleanOtp,
      purpose: 'signup',
    });

    if (userRow.isBanned) {
      res.status(403).json({ error: 'Account is suspended by an administrator.' });
      return;
    }

    const session = await createUserSession({
      userId: userRow.id,
      platform: detectPlatform(req, platform),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    setSessionCookie(res, session.token);
    const settings = await getAppSettings();
    res.json({
      token: session.token,
      user: toProfile(userRow),
      settings,
    });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to verify code.');
  }
});

app.post('/api/auth/resend-otp', otpLimiter, async (req, res) => {
  try {
    const { email, purpose = 'signup' } = req.body as {
      email?: string;
      purpose?: 'signup' | 'reset_password';
    };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Valid email is required.' });
      return;
    }

    const validPurpose = purpose === 'reset_password' ? 'reset_password' : 'signup';
    const userRow = await getUserRowByEmail(cleanEmail);
    if (!userRow) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    if (validPurpose === 'signup' && userRow.emailVerified) {
      res.status(400).json({ error: 'Email address is already verified.' });
      return;
    }

    const issued = await issueOtpRecord({
      userId: userRow.id,
      email: cleanEmail,
      purpose: validPurpose,
    });

    await sendVerificationOtpEmail({
      to: cleanEmail,
      fullName: userRow.fullName,
      otp: issued.otp,
      purpose: validPurpose,
    });

    res.json({
      sent: true,
      expiresInSeconds: 300,
      resendCooldownSeconds: 30,
    });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to resend verification code.');
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password, platform } = req.body as {
      email?: string;
      password?: string;
      platform?: string;
    };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = await authenticateWithPassword(cleanEmail, password);
    const session = await createUserSession({
      userId: user.id,
      platform: detectPlatform(req, platform),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    setSessionCookie(res, session.token);
    const settings = await getAppSettings();
    res.json({ token: session.token, user, settings });
  } catch (err) {
    sendErrorResponse(res, err, 'Login failed.');
  }
});

app.post('/api/auth/google', authLimiter, async (req, res) => {
  try {
    const { idToken, firebaseIdToken, platform } = req.body as {
      idToken?: string;
      firebaseIdToken?: string;
      platform?: string;
    };

    if (!idToken && !firebaseIdToken) {
      res.status(400).json({ error: 'Google ID token is required.' });
      return;
    }

    const verifiedProfile = await verifyGoogleCredential({
      idToken,
      firebaseIdToken,
    });
    const user = await upsertOAuthUser(verifiedProfile);
    const session = await createUserSession({
      userId: user.id,
      platform: detectPlatform(req, platform),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    setSessionCookie(res, session.token);
    const settings = await getAppSettings();
    res.json({ token: session.token, user, settings });
  } catch (err) {
    sendErrorResponse(res, err, 'Google authentication failed.');
  }
});

// Native iOS / Android / Web identityToken submission for Sign in with Apple
app.post('/api/auth/apple', authLimiter, async (req, res) => {
  try {
    const { identityToken, fullName, platform } = req.body as {
      identityToken?: string;
      fullName?: string;
      platform?: string;
    };
    if (!identityToken) {
      res.status(400).json({ error: 'Apple identityToken is required.' });
      return;
    }

    const verifiedProfile = await verifyAppleIdentityToken({
      identityToken,
      fullName,
    });
    const user = await upsertOAuthUser(verifiedProfile);
    const session = await createUserSession({
      userId: user.id,
      platform: detectPlatform(req, platform),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    setSessionCookie(res, session.token);
    const settings = await getAppSettings();
    res.json({ token: session.token, user, settings });
  } catch (err) {
    sendErrorResponse(res, err, 'Apple authentication failed.');
  }
});

// Web Sign in with Apple Popup Flow (per oauth/SKILL.md: direct provider URL in popup + form_post callback + postMessage)
app.get('/api/auth/apple/url', (req, res) => {
  const clientId = process.env.APPLE_SERVICE_ID?.trim();
  if (!clientId) {
    res.status(503).json({
      error:
        'Web Sign in with Apple requires APPLE_SERVICE_ID to be configured in server secrets.',
      code: 'APPLE_NOT_CONFIGURED',
    });
    return;
  }

  const baseUrl = getAppBaseUrl();
  const redirectUri = `${baseUrl}/auth/apple/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code id_token',
    scope: 'name email',
    response_mode: 'form_post',
    state,
    nonce,
  });

  res.json({ url: `https://appleid.apple.com/auth/authorize?${params.toString()}` });
});

async function handleAppleCallback(req: Request, res: Response) {
  try {
    const idToken = String(req.body?.id_token || req.query?.id_token || '');
    const rawUser = req.body?.user ? String(req.body.user) : '';
    let fullName: string | undefined;
    if (rawUser) {
      try {
        const parsed = JSON.parse(rawUser) as {
          name?: { firstName?: string; lastName?: string };
        };
        const first = parsed.name?.firstName || '';
        const last = parsed.name?.lastName || '';
        const combined = `${first} ${last}`.trim();
        if (combined) fullName = combined;
      } catch {
        // ignore optional Apple name JSON parse issue
      }
    }

    if (!idToken) {
      res.status(400).send('Missing Apple identity token.');
      return;
    }

    const verifiedProfile = await verifyAppleIdentityToken({
      identityToken: idToken,
      fullName,
    });
    const user = await upsertOAuthUser(verifiedProfile);
    const session = await createUserSession({
      userId: user.id,
      platform: 'web',
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    setSessionCookie(res, session.token);

    res.send(`<!doctype html>
<html>
  <body>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'CONNECT_APPLE_AUTH_SUCCESS' }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
    <p>Apple authentication complete. You may close this window.</p>
  </body>
</html>`);
  } catch (err) {
    const safeMsg = err instanceof Error ? err.message : 'Apple authentication failed';
    res.status(400).send(`<!doctype html>
<html>
  <body>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'CONNECT_APPLE_AUTH_ERROR', error: ${JSON.stringify(safeMsg)} }, '*');
        window.close();
      }
    </script>
    <p>${safeMsg.replace(/[<>&]/g, '')}</p>
  </body>
</html>`);
  }
}

app.post(['/auth/apple/callback', '/auth/apple/callback/'], handleAppleCallback);
app.get(['/auth/apple/callback', '/auth/apple/callback/'], handleAppleCallback);

app.post('/api/auth/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }

    const result = await initiatePasswordReset(cleanEmail);
    if (result.sent && result.user && result.otp) {
      await sendVerificationOtpEmail({
        to: result.user.email,
        fullName: result.user.fullName,
        otp: result.otp,
        purpose: 'reset_password',
      });
    }

    // Generic success response prevents user email enumeration
    res.json({
      success: true,
      expiresInSeconds: 300,
      resendCooldownSeconds: 30,
    });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to process forgot password request.');
  }
});

app.post('/api/auth/reset-password', otpLimiter, async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body as {
      email?: string;
      otp?: string;
      newPassword?: string;
      confirmPassword?: string;
    };
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanOtp = (otp || '').replace(/\s+/g, '');

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    if (!/^\d{6}$/.test(cleanOtp)) {
      res.status(400).json({ error: 'Please enter the 6-digit verification code.' });
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }
    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    await completePasswordReset({
      email: cleanEmail,
      otp: cleanOtp,
      newPassword,
    });

    clearSessionCookie(res);
    res.json({ success: true });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to reset password.');
  }
});

app.post('/api/auth/logout', requireAuth, async (req: AuthedRequest, res) => {
  try {
    if (req.sessionId) {
      await revokeSessionById(req.sessionId);
    }
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (err) {
    sendErrorResponse(res, err, 'Sign out failed.');
  }
});

app.delete('/api/auth/account', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    await deleteUserAccount(userId);
    clearSessionCookie(res);

    const sockets = clientsByUser.get(userId);
    if (sockets) {
      for (const ws of sockets) ws.close();
      clientsByUser.delete(userId);
    }
    broadcastAll('presence:changed', { userId, isOnline: false, deleted: true });
    res.json({ success: true });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to delete account.');
  }
});

// --- Profile & Settings ---

app.get('/api/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const settings = await getAppSettings();
    res.json({
      user: req.user,
      settings,
      wsToken: req.authToken,
    });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to load profile.');
  }
});

app.patch('/api/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const updated = await updateUserProfile(req.user!.id, req.body);
    broadcastAll('profile:updated', updated);
    res.json({ user: updated });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to update profile.');
  }
});

// --- Media Upload (Images & Voice Notes) ---

app.post('/api/upload', requireAuth, (req: AuthedRequest, res) => {
  const { dataUrl, mimeType } = req.body as { dataUrl?: string; mimeType?: string };
  if (!dataUrl || typeof dataUrl !== 'string') {
    res.status(400).json({ error: 'dataUrl is required' });
    return;
  }
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  const rawBase64 = match ? match[2] : dataUrl;
  const detectedMime = match ? match[1] : mimeType || 'application/octet-stream';

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
  };
  const ext = extMap[detectedMime.toLowerCase()] || 'bin';
  const filename = `${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(rawBase64, 'base64');
  if (buffer.length > 10 * 1024 * 1024) {
    res.status(413).json({ error: 'File exceeds 10MB limit' });
    return;
  }
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  res.json({ url: `/uploads/${filename}` });
});

// --- Users & Friendships ---

app.get('/api/users/search', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const usersList = await searchUsers(req.user!.id, String(req.query.q || ''));
    res.json({ users: usersList });
  } catch (err) {
    sendErrorResponse(res, err, 'Search failed.');
  }
});

app.get('/api/friendships', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const list = await getUserFriendships(req.user!.id);
    res.json({ friendships: list });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to fetch friendships.');
  }
});

app.post('/api/friendships', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await ensureInitialized();
    const userId = req.user!.id;
    const { addresseeId, status } = req.body as {
      addresseeId?: string;
      status?: 'pending' | 'blocked';
    };
    if (!addresseeId || addresseeId === userId) {
      res.status(400).json({ error: 'Invalid addresseeId' });
      return;
    }
    const target = await getUserById(addresseeId);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const desiredStatus = status === 'blocked' ? 'blocked' : 'pending';
    const existing = await db
      .select()
      .from(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, addresseeId)),
          and(eq(friendships.requesterId, addresseeId), eq(friendships.addresseeId, userId))
        )
      )
      .limit(1);

    const now = new Date();
    if (existing.length > 0) {
      if (desiredStatus === 'blocked') {
        await db
          .update(friendships)
          .set({
            requesterId: userId,
            addresseeId,
            status: 'blocked',
            updatedAt: now,
          })
          .where(eq(friendships.id, existing[0].id));
      } else if (existing[0].status === 'declined') {
        await db
          .update(friendships)
          .set({
            requesterId: userId,
            addresseeId,
            status: 'pending',
            updatedAt: now,
          })
          .where(eq(friendships.id, existing[0].id));
      }
    } else {
      await db.insert(friendships).values({
        id: crypto.randomUUID(),
        requesterId: userId,
        addresseeId,
        status: desiredStatus,
        createdAt: now,
        updatedAt: now,
      });
    }

    sendToUser(addresseeId, 'friendships:changed', {});
    sendToUser(userId, 'friendships:changed', {});
    res.status(201).json({ friendships: await getUserFriendships(userId) });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to update friendship.');
  }
});

app.patch('/api/friendships/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await ensureInitialized();
    const userId = req.user!.id;
    const id = String(req.params.id);
    const { status } = req.body as { status?: 'accepted' | 'declined' | 'blocked' };

    const rows = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, id))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Friendship not found' });
      return;
    }
    const row = rows[0];
    if (row.requesterId !== userId && row.addresseeId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (!status || !['accepted', 'declined', 'blocked'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    await db
      .update(friendships)
      .set({ status, updatedAt: new Date() })
      .where(eq(friendships.id, id));

    sendToUser(row.requesterId, 'friendships:changed', {});
    sendToUser(row.addresseeId, 'friendships:changed', {});
    res.json({ friendships: await getUserFriendships(userId) });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to update friendship.');
  }
});

app.delete('/api/friendships/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await ensureInitialized();
    const userId = req.user!.id;
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, id))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const row = rows[0];
    if (row.requesterId !== userId && row.addresseeId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await db.delete(friendships).where(eq(friendships.id, id));
    sendToUser(row.requesterId, 'friendships:changed', {});
    sendToUser(row.addresseeId, 'friendships:changed', {});
    res.json({ friendships: await getUserFriendships(userId) });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to delete friendship.');
  }
});

// --- Conversations & Messages ---

app.get('/api/conversations', requireAuth, async (req: AuthedRequest, res) => {
  try {
    res.json({ conversations: await getUserConversations(req.user!.id) });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to load conversations.');
  }
});

app.post('/api/conversations', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { type, participantIds = [], title } = req.body as {
      type?: 'direct' | 'group';
      participantIds?: string[];
      title?: string;
    };
    const conversation = await createOrFindConversation({
      userId,
      type: type === 'group' ? 'group' : 'direct',
      participantIds,
      title,
    });
    for (const pid of participantIds) {
      if (pid !== userId) {
        sendToUser(pid, 'conversations:changed', {});
      }
    }
    res.status(201).json({ conversation });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to create conversation.');
  }
});

app.get('/api/conversations/:id/messages', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    if (!(await isConversationMember(id, userId))) {
      res.status(403).json({ error: 'Not a member of this conversation' });
      return;
    }
    res.json({ messages: await getMessagesForConversation(id) });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to load messages.');
  }
});

app.post('/api/conversations/:id/messages', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    if (!(await isConversationMember(id, userId))) {
      res.status(403).json({ error: 'Not a member of this conversation' });
      return;
    }
    const settings = await getAppSettings();
    if (settings.maintenance_mode.enabled && req.user!.role !== 'admin') {
      res.status(503).json({ error: 'Service is in maintenance mode.' });
      return;
    }

    const members = await getConversationParticipants(id);
    if (members.length === 2) {
      const other = members.find((m) => m.id !== userId);
      if (other && (await isBlockedBetween(userId, other.id))) {
        res.status(403).json({ error: 'Messaging is blocked between participants.' });
        return;
      }
    }

    const { type = 'text', content = '', media_url = null, media_meta = null } =
      req.body as {
        type?: 'text' | 'image' | 'audio' | 'location';
        content?: string;
        media_url?: string | null;
        media_meta?: Record<string, unknown> | null;
      };

    if (type === 'text' && !String(content).trim()) {
      res.status(400).json({ error: 'Message content cannot be empty' });
      return;
    }

    const createdMsg = await createMessageRecord({
      conversationId: id,
      senderId: userId,
      type,
      content: String(content).trim(),
      mediaUrl: media_url,
      mediaMeta: media_meta,
    });

    await broadcastToConversation(id, 'message:created', {
      conversationId: id,
      message: createdMsg,
    });
    res.status(201).json({ message: createdMsg });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to send message.');
  }
});

app.post('/api/conversations/:id/read', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    if (!(await isConversationMember(id, userId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { messageIds, readAt } = await markConversationMessagesRead(id, userId);
    if (messageIds.length > 0) {
      await broadcastToConversation(id, 'message:read', {
        conversationId: id,
        userId,
        messageIds,
        readAt,
      });
    }
    res.json({ readCount: messageIds.length });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to update read receipts.');
  }
});

app.delete('/api/messages/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await ensureInitialized();
    const userId = req.user!.id;
    const id = String(req.params.id);
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const row = rows[0];
    if (row.senderId !== userId && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You can only delete your own messages.' });
      return;
    }

    await db
      .update(messages)
      .set({ isDeleted: true, content: '', mediaUrl: null })
      .where(eq(messages.id, id));

    await broadcastToConversation(row.conversationId, 'message:deleted', {
      conversationId: row.conversationId,
      messageId: id,
    });
    res.json({ success: true });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to delete message.');
  }
});

// --- Calls & WebRTC ICE Servers ---

app.get('/api/webrtc/ice-servers', requireAuth, (_req, res) => {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (
    process.env.COTURN_URL &&
    process.env.COTURN_USERNAME &&
    process.env.COTURN_PASSWORD
  ) {
    iceServers.push({
      urls: process.env.COTURN_URL,
      username: process.env.COTURN_USERNAME,
      credential: process.env.COTURN_PASSWORD,
    });
  }
  res.json({ iceServers });
});

app.get('/api/calls', requireAuth, async (req: AuthedRequest, res) => {
  try {
    res.json({ calls: await getUserCalls(req.user!.id) });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to fetch calls.');
  }
});

app.post('/api/calls', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await ensureInitialized();
    const userId = req.user!.id;
    const { conversationId, type } = req.body as {
      conversationId?: string;
      type?: 'audio' | 'video';
    };
    if (!conversationId || (type !== 'audio' && type !== 'video')) {
      res.status(400).json({ error: 'conversationId and valid call type are required' });
      return;
    }
    if (!(await isConversationMember(conversationId, userId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const members = await getConversationParticipants(conversationId);
    const settings = await getAppSettings();
    const check = canInitiateCall(
      settings,
      type,
      members.length,
      req.user!.role === 'admin'
    );
    if (!check.allowed) {
      res.status(403).json({ error: `Call blocked by policy: ${check.reason}` });
      return;
    }

    for (const m of members) {
      if (m.id !== userId && (await isBlockedBetween(userId, m.id))) {
        res.status(403).json({ error: 'Call blocked between users.' });
        return;
      }
    }

    const callId = crypto.randomUUID();
    const now = new Date();
    const [insertedCall] = await db
      .insert(calls)
      .values({
        id: callId,
        conversationId,
        callerId: userId,
        type,
        status: 'ringing',
        startedAt: now,
        endedAt: null,
      })
      .returning();

    await db.insert(callParticipants).values(
      members.map((m) => ({
        callId,
        userId: m.id,
        status: m.id === userId ? 'joined' : 'invited',
        joinedAt: m.id === userId ? now : null,
        leftAt: null,
      }))
    );

    const callRecord = await enrichCallRecord(insertedCall);
    for (const m of members) {
      if (m.id !== userId) {
        sendToUser(m.id, 'call:incoming', callRecord);
      }
    }
    res.status(201).json({ call: callRecord });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to initiate call.');
  }
});

app.patch('/api/calls/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await ensureInitialized();
    const userId = req.user!.id;
    const id = String(req.params.id);
    if (!(await isCallParticipant(id, userId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { action } = req.body as { action?: 'join' | 'decline' | 'end' };
    const now = new Date();

    if (action === 'join') {
      await db
        .update(callParticipants)
        .set({ status: 'joined', joinedAt: now })
        .where(
          and(eq(callParticipants.callId, id), eq(callParticipants.userId, userId))
        );
      await db
        .update(calls)
        .set({ status: 'active' })
        .where(and(eq(calls.id, id), eq(calls.status, 'ringing')));
    } else if (action === 'decline') {
      await db
        .update(callParticipants)
        .set({ status: 'declined', leftAt: now })
        .where(
          and(eq(callParticipants.callId, id), eq(callParticipants.userId, userId))
        );

      const remaining = await db
        .select({ userId: callParticipants.userId })
        .from(callParticipants)
        .where(
          and(
            eq(callParticipants.callId, id),
            ne(callParticipants.userId, userId),
            sql`${callParticipants.status} IN ('invited', 'joined')`
          )
        );

      if (remaining.length === 0) {
        await db
          .update(calls)
          .set({ status: 'declined', endedAt: now })
          .where(eq(calls.id, id));
      }
    } else if (action === 'end') {
      await db
        .update(callParticipants)
        .set({
          status: sql`CASE WHEN ${callParticipants.status} = 'invited' THEN 'missed' ELSE 'left' END`,
          leftAt: now,
        })
        .where(and(eq(callParticipants.callId, id), isNull(callParticipants.leftAt)));

      await db
        .update(calls)
        .set({
          status: sql`CASE WHEN ${calls.status} = 'ringing' THEN 'missed' ELSE 'ended' END`,
          endedAt: now,
        })
        .where(and(eq(calls.id, id), isNull(calls.endedAt)));
    } else {
      res.status(400).json({ error: 'Invalid call action' });
      return;
    }

    const callRows = await db
      .select()
      .from(calls)
      .where(eq(calls.id, id))
      .limit(1);
    const updated = await enrichCallRecord(callRows[0]);
    for (const p of updated.participants) {
      sendToUser(p.user_id, 'call:updated', updated);
    }
    res.json({ call: updated });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to update call state.');
  }
});

// --- Reports & Admin Console ---

app.post('/api/reports', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await ensureInitialized();
    const userId = req.user!.id;
    const { reportedUserId, reason, details } = req.body as {
      reportedUserId?: string;
      reason?: string;
      details?: string;
    };
    if (!reportedUserId || !reason || !reason.trim()) {
      res.status(400).json({ error: 'reportedUserId and reason are required' });
      return;
    }
    const id = crypto.randomUUID();
    await db.insert(reports).values({
      id,
      reporterId: userId,
      reportedUserId,
      reason: reason.trim(),
      details: details?.trim() || null,
      status: 'pending',
    });
    res.status(201).json({ success: true, id });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to submit report.');
  }
});

app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await getAdminOverviewData());
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to load admin overview.');
  }
});

app.patch('/api/admin/reports/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureInitialized();
    const id = String(req.params.id);
    const { status } = req.body as {
      status?: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
    };
    if (!status || !['pending', 'reviewed', 'resolved', 'dismissed'].includes(status)) {
      res.status(400).json({ error: 'Invalid report status' });
      return;
    }
    await db.update(reports).set({ status }).where(eq(reports.id, id));
    res.json({ reports: await getAllReports() });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to update report.');
  }
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await ensureInitialized();
    const id = String(req.params.id);
    const { is_banned, role } = req.body as {
      is_banned?: boolean;
      role?: 'user' | 'admin';
    };
    if (id === req.user!.id && is_banned === true) {
      res.status(400).json({ error: 'Cannot ban your own admin account.' });
      return;
    }
    if (typeof is_banned === 'boolean') {
      await db
        .update(users)
        .set({ isBanned: is_banned, updatedAt: new Date() })
        .where(eq(users.id, id));
      if (is_banned) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
        const sockets = clientsByUser.get(id);
        if (sockets) {
          for (const ws of sockets) ws.close();
          clientsByUser.delete(id);
        }
      }
    }
    if (role === 'user' || role === 'admin') {
      await db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, id));
    }
    const overview = await getAdminOverviewData();
    res.json({ users: overview.users });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to update user.');
  }
});

app.patch('/api/admin/settings/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const key = String(req.params.key);
    if (key !== 'maintenance_mode' && key !== 'calls_enabled') {
      res.status(400).json({ error: 'Unknown settings key' });
      return;
    }
    const settings = await updateAppSetting(key, req.body);
    broadcastAll('settings:updated', settings);
    res.json({ settings });
  } catch (err) {
    sendErrorResponse(res, err, 'Failed to update settings.');
  }
});

// --- Start HTTP + WebSocket + Vite Server ---

async function startServer() {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '/', 'http://localhost:3000');
    const queryToken = url.searchParams.get('token') || '';
    const cookies = parseCookies(req.headers.cookie);
    const token = queryToken || cookies[SESSION_COOKIE_NAME] || '';

    const sessionData = await getUserBySessionToken(token);
    if (!sessionData || sessionData.user.is_banned) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const user = sessionData.user;
    let set = clientsByUser.get(user.id);
    if (!set) {
      set = new Set();
      clientsByUser.set(user.id, set);
    }
    set.add(ws);

    await updateUserPresence(user.id, true);
    broadcastAll('presence:changed', { userId: user.id, isOnline: true });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          event?: string;
          payload?: Record<string, unknown>;
        };
        if (msg.event === 'typing:start' || msg.event === 'typing:stop') {
          const conversationId = String(msg.payload?.conversationId || '');
          if (conversationId && (await isConversationMember(conversationId, user.id))) {
            await broadcastToConversation(conversationId, msg.event, {
              conversationId,
              userId: user.id,
              fullName: user.full_name,
            });
          }
        } else if (msg.event === 'webrtc:signal') {
          const sig = msg.payload as unknown as SignalPayload;
          if (!sig?.callId || !(await isCallParticipant(sig.callId, user.id))) return;
          const forwarded: SignalPayload = { ...sig, from: user.id };
          if (sig.to) {
            sendToUser(sig.to, 'webrtc:signal', forwarded);
          } else {
            const parts = await db
              .select({ userId: callParticipants.userId })
              .from(callParticipants)
              .where(eq(callParticipants.callId, sig.callId));
            for (const p of parts) {
              if (p.userId !== user.id) {
                sendToUser(p.userId, 'webrtc:signal', forwarded);
              }
            }
          }
        }
      } catch {
        // ignore malformed WS frames
      }
    });

    ws.on('close', async () => {
      const userSockets = clientsByUser.get(user.id);
      if (userSockets) {
        userSockets.delete(ws);
        if (userSockets.size === 0) {
          clientsByUser.delete(user.id);
          await updateUserPresence(user.id, false);
          broadcastAll('presence:changed', { userId: user.id, isOnline: false });
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Connect server running on http://localhost:${port}`);
  });
}

startServer();
