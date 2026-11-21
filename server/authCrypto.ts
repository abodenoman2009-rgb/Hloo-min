import crypto from 'node:crypto';
import argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { adminAuth, firebaseConfig } from '../src/lib/firebase-admin.ts';
import { isApplePrivateRelayEmail } from '../src/lib/connectLogic.ts';

// Ephemeral in-memory fallback when JWT_SECRET is not provided in server environment
const RUNTIME_JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16
    ? process.env.JWT_SECRET
    : crypto.randomBytes(32).toString('hex');

const JWT_KEY_BYTES = new TextEncoder().encode(RUNTIME_JWT_SECRET);
const GOOGLE_OAUTH_CLIENT = new OAuth2Client();
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export async function hashPasswordArgon2(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPasswordHash(
  password: string,
  storedHash: string | null | undefined
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!storedHash) return { valid: false, needsRehash: false };

  if (storedHash.startsWith('$argon2')) {
    try {
      const ok = await argon2.verify(storedHash, password);
      return { valid: ok, needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  // Fallback compatibility for scrypt salt:hex hashes
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return { valid: false, needsRehash: false };
  try {
    const keyBuf = Buffer.from(key, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return { valid: false, needsRehash: false };
    const valid = crypto.timingSafeEqual(keyBuf, derivedBuf);
    return { valid, needsRehash: valid };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

export function generateNumericOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashOtpCode(verificationId: string, otp: string): string {
  return crypto
    .createHmac('sha256', RUNTIME_JWT_SECRET)
    .update(`${verificationId}:${otp.trim()}`)
    .digest('hex');
}

export function verifyOtpHash(verificationId: string, otp: string, expectedHex: string): boolean {
  const actualHex = hashOtpCode(verificationId, otp);
  const a = Buffer.from(actualHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function hashSessionJti(jti: string): string {
  return crypto.createHash('sha256').update(jti).digest('hex');
}

export async function signSessionJwt(params: {
  userId: string;
  sessionId: string;
  jti: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const ttl = params.expiresInSeconds ?? 60 * 60 * 24 * 14;
  return new SignJWT({ sid: params.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(params.userId)
    .setJti(params.jti)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(JWT_KEY_BYTES);
}

export async function verifySessionJwt(
  token: string
): Promise<{ userId: string; sessionId: string; jti: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_KEY_BYTES, {
      algorithms: ['HS256'],
    });
    if (!payload.sub || !payload.jti || typeof payload.sid !== 'string') {
      return null;
    }
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      jti: payload.jti,
    };
  } catch {
    return null;
  }
}

export interface VerifiedOAuthProfile {
  provider: 'google' | 'apple';
  providerAccountId: string;
  uid?: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
  avatarUrl: string | null;
  isPrivateRelay: boolean;
}

export class InvalidOAuthTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOAuthTokenError';
  }
}

export class AppleNotConfiguredError extends Error {
  constructor(message = 'Apple Sign-In is not configured on the server yet.') {
    super(message);
    this.name = 'AppleNotConfiguredError';
  }
}

/**
 * Parses comma-separated OAuth client IDs cleanly from configuration values.
 */
function collectGoogleAudiences(): string[] {
  const raw = [
    firebaseConfig.oAuthClientId,
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
  ];
  const result = new Set<string>();
  for (const item of raw) {
    if (!item) continue;
    for (const part of item.split(',')) {
      const trimmed = part.trim();
      if (trimmed) result.add(trimmed);
    }
  }
  return [...result];
}

async function verifyRawGoogleIdToken(
  idToken: string,
  audiences: string[]
): Promise<VerifiedOAuthProfile> {
  let payload;
  try {
    const ticket = await GOOGLE_OAUTH_CLIENT.verifyIdToken({
      idToken,
      audience: audiences.length > 0 ? audiences : undefined,
    });
    payload = ticket.getPayload();
  } catch {
    throw new InvalidOAuthTokenError('Invalid or expired Google ID token.');
  }
  if (!payload || !payload.sub || !payload.email) {
    throw new InvalidOAuthTokenError('Google ID token did not contain valid account claims.');
  }
  const emailVerified =
    payload.email_verified === true || String(payload.email_verified) === 'true';
  if (!emailVerified) {
    throw new InvalidOAuthTokenError('Google account email must be verified.');
  }
  return {
    provider: 'google',
    providerAccountId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    fullName: payload.name || null,
    avatarUrl: payload.picture || null,
    isPrivateRelay: false,
  };
}

async function verifyFirebaseGoogleIdToken(
  firebaseIdToken: string
): Promise<VerifiedOAuthProfile> {
  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(firebaseIdToken);
  } catch {
    throw new InvalidOAuthTokenError('Invalid or expired Google session token.');
  }

  const googleIdentities = decoded.firebase?.identities?.['google.com'];
  const isGoogleSignIn =
    decoded.firebase?.sign_in_provider === 'google.com' ||
    (Array.isArray(googleIdentities) && googleIdentities.length > 0);
  if (!isGoogleSignIn) {
    throw new InvalidOAuthTokenError('Token is not from a verified Google sign-in session.');
  }

  const fallbackIdentityEmail =
    Array.isArray(decoded.firebase?.identities?.email) &&
    typeof decoded.firebase.identities.email[0] === 'string'
      ? decoded.firebase.identities.email[0]
      : undefined;
  const resolvedEmail = (decoded.email || fallbackIdentityEmail || '').trim().toLowerCase();

  if (!decoded.uid || !resolvedEmail) {
    throw new InvalidOAuthTokenError('Google session token missing verified email.');
  }
  if (decoded.email_verified === false) {
    throw new InvalidOAuthTokenError('Google account email must be verified.');
  }

  const providerSub =
    (Array.isArray(googleIdentities) && googleIdentities[0]) || decoded.uid;

  return {
    provider: 'google',
    providerAccountId: String(providerSub),
    uid: decoded.uid,
    email: resolvedEmail,
    emailVerified: true,
    fullName: typeof decoded.name === 'string' ? decoded.name : null,
    avatarUrl: typeof decoded.picture === 'string' ? decoded.picture : null,
    isPrivateRelay: false,
  };
}

/**
 * Verifies a Google ID Token (from iOS/Android native Google Sign-In or GIS)
 * OR a Firebase Auth ID Token (from signInWithPopup / signInWithRedirect)
 * strictly on the server. When both are provided and the Google OIDC token
 * uses an external Firebase client audience, verifies the Firebase ID token directly.
 */
export async function verifyGoogleCredential(input: {
  idToken?: string;
  firebaseIdToken?: string;
}): Promise<VerifiedOAuthProfile> {
  const audiences = collectGoogleAudiences();

  if (input.idToken && input.firebaseIdToken) {
    // Verify Firebase ID token first as authoritative for Firebase Auth web flow,
    // or fall back cleanly between the two cryptographically verified tokens.
    try {
      return await verifyFirebaseGoogleIdToken(input.firebaseIdToken);
    } catch {
      return await verifyRawGoogleIdToken(input.idToken, audiences);
    }
  }

  if (input.idToken) {
    return verifyRawGoogleIdToken(input.idToken, audiences);
  }

  if (input.firebaseIdToken) {
    return verifyFirebaseGoogleIdToken(input.firebaseIdToken);
  }

  throw new InvalidOAuthTokenError('Missing Google verification token.');
}

/**
 * Verifies an Apple Identity Token cryptographically against Apple's JWKS.
 * Supports iOS native bundle IDs and Web Services IDs, plus Apple Private Relay emails.
 */
export async function verifyAppleIdentityToken(input: {
  identityToken: string;
  fullName?: string;
}): Promise<VerifiedOAuthProfile> {
  const allowedAudiences = [
    process.env.APPLE_SERVICE_ID,
    process.env.APPLE_BUNDLE_ID,
  ].filter((v): v is string => Boolean(v && v.trim()));

  if (allowedAudiences.length === 0) {
    throw new AppleNotConfiguredError();
  }

  let payload;
  try {
    const verified = await jwtVerify(input.identityToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: allowedAudiences,
    });
    payload = verified.payload;
  } catch {
    throw new InvalidOAuthTokenError('Invalid or expired Apple identity token.');
  }

  if (!payload.sub) {
    throw new InvalidOAuthTokenError('Apple identity token is missing subject identifier.');
  }

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  const emailVerified =
    payload.email_verified === true || payload.email_verified === 'true';
  const isPrivateRelay = isApplePrivateRelayEmail(
    email,
    payload.is_private_email as boolean | string | undefined
  );

  return {
    provider: 'apple',
    providerAccountId: payload.sub,
    email,
    emailVerified: email ? emailVerified : true,
    fullName: input.fullName?.trim() || null,
    avatarUrl: null,
    isPrivateRelay,
  };
}
