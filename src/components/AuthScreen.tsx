import { useEffect, useState, type FormEvent } from 'react';
import {
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Mail,
  Moon,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { t } from '../i18n';
import { ApiError, api } from '../lib/api';
import {
  formatSecondsTimer,
  mapFirebaseAuthErrorCode,
  validateAuthForm,
} from '../lib/connectLogic';
import { auth, googleAuthProvider } from '../lib/firebase';
import type {
  AppSettings,
  Language,
  ThemeMode,
  UserProfile,
} from '../types';

type AuthMode =
  | 'login'
  | 'signup'
  | 'verify_otp'
  | 'forgot_password'
  | 'reset_password';

interface AuthScreenProps {
  lang: Language;
  theme: ThemeMode;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onAuthenticated: (token: string, user: UserProfile, settings: AppSettings) => Promise<void> | void;
}

function GoogleMark() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.08.73-2.46 1.16-4.22 1.16-3.24 0-5.99-2.19-6.97-5.13H1.03v3.14C3.05 21.18 7.21 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.03 14.02c-.25-.73-.39-1.51-.39-2.32s.14-1.59.39-2.32V6.24H1.03A11.98 11.98 0 0 0 0 11.7c0 1.93.46 3.76 1.03 5.46l4-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.79 0 3.4.62 4.67 1.83l3.5-3.5C18.07 1.19 15.3 0 12 0 7.21 0 3.05 2.82 1.03 6.86l4 3.14c.98-2.94 3.73-5.25 6.97-5.25Z"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg
      className="w-4 h-4 shrink-0 fill-current"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43Zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45Z" />
    </svg>
  );
}

export function AuthScreen({
  lang,
  theme,
  onToggleLang,
  onToggleTheme,
  onAuthenticated,
}: AuthScreenProps) {
  const dict = t(lang);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<'google' | 'apple' | null>(null);

  const [otpExpirySeconds, setOtpExpirySeconds] = useState(0);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);

  // Live countdown timers for OTP expiry (5:00) & resend cooldown (30s)
  useEffect(() => {
    if (otpExpirySeconds <= 0 && resendCooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setOtpExpirySeconds((s) => (s > 0 ? s - 1 : 0));
      setResendCooldownSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [otpExpirySeconds > 0, resendCooldownSeconds > 0]);

  // Listen for Apple Web Sign-In popup callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'CONNECT_APPLE_AUTH_SUCCESS') {
        setOauthBusy(null);
        try {
          const me = await api.getMe();
          await onAuthenticated(me.wsToken || '', me.user, me.settings);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : lang === 'ar'
              ? 'تعذر استكمال جلسة Apple.'
              : 'Unable to complete Apple session.'
          );
        }
      } else if (event.data?.type === 'CONNECT_APPLE_AUTH_ERROR') {
        setOauthBusy(null);
        setError(
          typeof event.data.error === 'string'
            ? event.data.error
            : lang === 'ar'
            ? 'فشل تسجيل الدخول عبر Apple.'
            : 'Apple sign-in failed.'
        );
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [lang, onAuthenticated]);

  // Complete Google Sign-In if returning from standalone redirect fallback
  useEffect(() => {
    let active = true;
    const hasPendingRedirect = (() => {
      try {
        return sessionStorage.getItem('connect_google_redirect') === '1';
      } catch {
        return false;
      }
    })();

    if (!hasPendingRedirect) return;

    setOauthBusy('google');
    getRedirectResult(auth)
      .then(async (result) => {
        try {
          sessionStorage.removeItem('connect_google_redirect');
        } catch {}
        if (!active || !result) return;
        const firebaseIdToken = await result.user.getIdToken(true);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const res = await api.loginWithGoogle({
          firebaseIdToken,
          idToken: credential?.idToken || undefined,
        });
        if (active) {
          await onAuthenticated(res.token, res.user, res.settings);
        }
      })
      .catch(async (err) => {
        try {
          sessionStorage.removeItem('connect_google_redirect');
        } catch {}
        await signOut(auth).catch(() => {});
        if (active) {
          setError(mapServerError(err));
        }
      })
      .finally(() => {
        if (active) setOauthBusy(null);
      });

    return () => {
      active = false;
    };
  }, [lang, onAuthenticated]);

  function mapServerError(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === 'SMTP_NOT_CONFIGURED') {
        return lang === 'ar'
          ? 'خدمة إرسال البريد الإلكتروني غير مفعّلة حالياً من إعدادات النظام. يرجى استكمال إعداد البريد لإرسال رموز التحقق.'
          : 'Email delivery is not configured yet for sending verification codes.';
      }
      if (err.code === 'EMAIL_EXISTS') {
        return lang === 'ar'
          ? 'هذا البريد الإلكتروني مسجل مسبقاً. يمكنك تسجيل الدخول أو استعادة كلمة المرور.'
          : 'An account with this email already exists. Try signing in instead.';
      }
      if (err.code === 'INVALID_CREDENTIALS') {
        return lang === 'ar'
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
          : 'Invalid email address or password.';
      }
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        return lang === 'ar'
          ? 'يجب تأكيد البريد الإلكتروني برمز التحقق (6 أرقام) قبل تسجيل الدخول.'
          : 'Please verify your email address with the 6-digit code before signing in.';
      }
      if (err.code === 'RESEND_COOLDOWN') {
        if (err.retryAfterSeconds) {
          setResendCooldownSeconds(err.retryAfterSeconds);
        }
        return lang === 'ar'
          ? `يرجى الانتظار ${err.retryAfterSeconds ?? 30} ثانية قبل إعادة إرسال الرمز.`
          : `Please wait ${err.retryAfterSeconds ?? 30} seconds before requesting a new code.`;
      }
      if (err.code === 'OTP_EXPIRED') {
        return lang === 'ar'
          ? 'انتهت صلاحية رمز التحقق (5 دقائق). يرجى طلب رمز جديد.'
          : 'Your verification code has expired (5 minutes). Request a new code.';
      }
      if (err.code === 'OTP_MAX_ATTEMPTS') {
        return lang === 'ar'
          ? 'تم تجاوز الحد الأقصى لمحاولات إدخال الرمز. يرجى طلب رمز تحقق جديد.'
          : 'Maximum verification attempts exceeded. Request a new verification code.';
      }
      if (err.code === 'OTP_INVALID') {
        return lang === 'ar'
          ? `رمز التحقق غير صحيح. المحاولات المتبقية: ${err.remainingAttempts ?? 0}.`
          : `Invalid verification code. ${err.remainingAttempts ?? 0} attempt(s) left.`;
      }
      if (err.code === 'INVALID_OAUTH_TOKEN') {
        return lang === 'ar'
          ? 'تعذر التحقق من رمز Google لدى الخادم. يرجى إعادة المحاولة.'
          : 'Unable to verify Google token on the server. Please try again.';
      }
      if (err.code === 'OAUTH_EMAIL_MISSING') {
        return lang === 'ar'
          ? 'لم يتم استلام البريد الإلكتروني من مزوّد الدخول. يرجى منح صلاحية البريد والمحاولة مجدداً.'
          : 'Verified email address was not provided by the sign-in provider.';
      }
      if (err.code === 'ACCOUNT_BANNED') {
        return lang === 'ar'
          ? 'تم تعليق هذا الحساب من قِبل المشرف.'
          : 'This account has been suspended by an administrator.';
      }
      if (err.code === 'APPLE_NOT_CONFIGURED') {
        return lang === 'ar'
          ? 'تسجيل الدخول عبر Apple غير مفعّل على الويب حالياً، أو يمكن استخدامه عبر تطبيق iOS.'
          : 'Sign in with Apple on Web is not enabled yet on this server, or sign in via the iOS app.';
      }
      if (err.code === 'RATE_LIMITED') {
        return lang === 'ar'
          ? 'تم تجاوز عدد المحاولات المسموح به. يرجى الانتظار بضع دقائق ثم المحاولة مجدداً.'
          : 'Too many requests. Please wait a few minutes and try again.';
      }
      return err.message;
    }

    if (err && typeof err === 'object' && 'code' in err) {
      const fbCode = String((err as { code?: unknown }).code || '');
      const mapped = mapFirebaseAuthErrorCode(fbCode, lang);
      if (mapped) return mapped;
    }

    return err instanceof Error ? err.message : 'Authentication failed';
  }

  function switchMode(next: AuthMode) {
    setError(null);
    setNotice(null);
    setMode(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const validationErr = validateAuthForm(
      mode,
      {
        email,
        password,
        confirmPassword,
        fullName,
        username,
        otp,
      },
      lang
    );
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await api.login(email, password);
        await onAuthenticated(res.token, res.user, res.settings);
      } else if (mode === 'signup') {
        const res = await api.signup({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          confirmPassword,
          username: username.trim() || undefined,
        });
        setOtp('');
        setOtpExpirySeconds(res.expiresInSeconds || 300);
        setResendCooldownSeconds(res.resendCooldownSeconds || 30);
        setMode('verify_otp');
        setNotice(
          lang === 'ar'
            ? `تم إرسال رمز تحقق مكوّن من 6 أرقام إلى ${res.email}.`
            : `We sent a 6-digit verification code to ${res.email}.`
        );
      } else if (mode === 'verify_otp') {
        const res = await api.verifyOtp({ email: email.trim(), otp: otp.trim() });
        await onAuthenticated(res.token, res.user, res.settings);
      } else if (mode === 'forgot_password') {
        const res = await api.forgotPassword(email.trim());
        setOtp('');
        setPassword('');
        setConfirmPassword('');
        setOtpExpirySeconds(res.expiresInSeconds || 300);
        setResendCooldownSeconds(res.resendCooldownSeconds || 30);
        setMode('reset_password');
        setNotice(
          lang === 'ar'
            ? 'إذا كان البريد مسجلاً لدينا، فقد تم إرسال رمز إعادة تعيين كلمة المرور المكوّن من 6 أرقام.'
            : 'If this email is registered, we have sent a 6-digit password reset code.'
        );
      } else if (mode === 'reset_password') {
        await api.resetPassword({
          email: email.trim(),
          otp: otp.trim(),
          newPassword: password,
          confirmPassword,
        });
        setOtp('');
        setPassword('');
        setConfirmPassword('');
        setMode('login');
        setNotice(
          lang === 'ar'
            ? 'تم تحديث كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.'
            : 'Your password has been updated. You can sign in now.'
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setMode('verify_otp');
        setNotice(
          lang === 'ar'
            ? 'أدخل رمز التحقق المرسل لبريدك أو اطلب إعادة الإرسال.'
            : 'Enter the 6-digit code sent to your email or request a new one.'
        );
      }
      setError(mapServerError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp(purpose: 'signup' | 'reset_password') {
    if (resendCooldownSeconds > 0 || loading) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await api.resendOtp({ email: email.trim(), purpose });
      setOtpExpirySeconds(res.expiresInSeconds || 300);
      setResendCooldownSeconds(res.resendCooldownSeconds || 30);
      setNotice(
        lang === 'ar'
          ? 'تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني.'
          : 'A new 6-digit code has been sent to your email.'
      );
    } catch (err) {
      setError(mapServerError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError(null);
    setNotice(null);
    setOauthBusy('google');
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      const firebaseIdToken = await result.user.getIdToken(true);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const res = await api.loginWithGoogle({
        firebaseIdToken,
        idToken: credential?.idToken || undefined,
      });
      await onAuthenticated(res.token, res.user, res.settings);
    } catch (err) {
      const fbCode =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      const isInIframe = (() => {
        try {
          return window.self !== window.top;
        } catch {
          return true;
        }
      })();

      // Fallback to redirect flow only when running top-level (e.g. mobile Safari/Chrome)
      if (
        !isInIframe &&
        (fbCode === 'auth/popup-blocked' ||
          fbCode === 'auth/operation-not-supported-in-this-environment')
      ) {
        try {
          sessionStorage.setItem('connect_google_redirect', '1');
        } catch {}
        await signInWithRedirect(auth, googleAuthProvider);
        return;
      }

      await signOut(auth).catch(() => {});
      setError(mapServerError(err));
    } finally {
      setOauthBusy(null);
    }
  }

  async function handleAppleLogin() {
    setError(null);
    setNotice(null);
    setOauthBusy('apple');
    try {
      const { url } = await api.getAppleAuthUrl();
      const popup = window.open(url, 'connect_apple_auth', 'width=560,height=680');
      if (!popup) {
        setOauthBusy(null);
        setError(
          lang === 'ar'
            ? 'يرجى السماح بالنوافذ المنبثقة للمتابعة عبر Apple.'
            : 'Please allow popups in your browser to sign in with Apple.'
        );
      }
    } catch (err) {
      setOauthBusy(null);
      setError(mapServerError(err));
    }
  }

  const currentHeading =
    mode === 'login'
      ? dict.authTitleSignIn
      : mode === 'signup'
      ? dict.authTitleSignUp
      : mode === 'verify_otp'
      ? dict.authTitleVerifyOtp
      : mode === 'forgot_password'
      ? dict.authTitleForgot
      : dict.authTitleReset;

  const showSocialButtons = mode === 'login' || mode === 'signup';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar: Clean 3-zone contract */}
      <header className="w-full border-b border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            {dict.brandFull}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onToggleLang}
              className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              aria-label={dict.languageLabel}
            >
              <Globe className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              aria-label={theme === 'dark' ? dict.lightMode : dict.darkMode}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Responsive Split Grid */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Primary Authentication Surface */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white text-balance">
              {currentHeading}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {dict.authSubtitle}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="mb-4 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-sm text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{notice}</span>
            </div>
          )}

          {/* OAuth Provider Buttons */}
          {showSocialButtons && (
            <div className="space-y-3 mb-6">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading || oauthBusy !== null}
                className="w-full min-h-[46px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-center gap-3 transition-colors whitespace-nowrap"
              >
                <GoogleMark />
                <span>
                  {oauthBusy === 'google'
                    ? lang === 'ar'
                      ? 'جاري التحقق عبر Google...'
                      : 'Verifying Google account...'
                    : dict.continueWithGoogle}
                </span>
              </button>

              <button
                type="button"
                onClick={handleAppleLogin}
                disabled={loading || oauthBusy !== null}
                className="w-full min-h-[46px] px-4 rounded-xl bg-slate-950 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-60 text-sm font-semibold text-white dark:text-slate-950 flex items-center justify-center gap-3 transition-colors whitespace-nowrap"
              >
                <AppleMark />
                <span>
                  {oauthBusy === 'apple'
                    ? lang === 'ar'
                      ? 'جاري التحقق عبر Apple...'
                      : 'Verifying Apple ID...'
                    : dict.continueWithApple}
                </span>
              </button>

              <div className="relative py-2 flex items-center justify-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                <span className="px-3 bg-white dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                  {dict.orWithEmail}
                </span>
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="auth-fullname"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {dict.fullName}
                  </label>
                  <input
                    id="auth-fullname"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={lang === 'ar' ? 'ليلى المنصور' : 'Layla Al-Mansoor'}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label
                    htmlFor="auth-username"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    {dict.username}
                  </label>
                  <input
                    id="auth-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="layla_m"
                    dir="ltr"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>
            )}

            {/* Email field */}
            <div>
              <label
                htmlFor="auth-email"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {dict.email}
              </label>
              <input
                id="auth-email"
                type="email"
                dir="ltr"
                required
                readOnly={mode === 'verify_otp'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@domain.com"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm read-only:opacity-75 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            {/* 6-Digit OTP Input for verify_otp and reset_password */}
            {(mode === 'verify_otp' || mode === 'reset_password') && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="auth-otp"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    {dict.otpLabel}
                  </label>
                  {otpExpirySeconds > 0 && (
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {dict.otpExpiresIn} · {formatSecondsTimer(otpExpirySeconds)}
                    </span>
                  )}
                </div>
                <input
                  id="auth-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  dir="ltr"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-center text-lg font-mono font-bold tracking-[0.45em] tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            )}

            {/* Password field */}
            {(mode === 'login' || mode === 'signup' || mode === 'reset_password') && (
              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {mode === 'reset_password' ? dict.newPasswordLabel : dict.password}
                </label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    dir="ltr"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 px-3.5 pr-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-1 flex items-center justify-center w-10 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label={
                      lang === 'ar'
                        ? showPassword
                          ? 'إخفاء كلمة المرور'
                          : 'إظهار كلمة المرور'
                        : showPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Confirm Password field */}
            {(mode === 'signup' || mode === 'reset_password') && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {mode === 'reset_password'
                    ? dict.confirmNewPasswordLabel
                    : dict.confirmPassword}
                </label>
                <input
                  id="auth-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            )}

            {/* Primary Submit Button */}
            <button
              type="submit"
              disabled={loading || oauthBusy !== null}
              className="w-full min-h-[46px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-2"
            >
              <Mail className="w-4 h-4" aria-hidden="true" />
              <span>
                {mode === 'login'
                  ? dict.signIn
                  : mode === 'signup'
                  ? dict.signUp
                  : mode === 'verify_otp'
                  ? dict.verifyOtpButton
                  : mode === 'forgot_password'
                  ? dict.sendReset
                  : dict.confirmResetButton}
              </span>
            </button>
          </form>

          {/* OTP Resend Control with 30-second cooldown */}
          {(mode === 'verify_otp' || mode === 'reset_password') && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={resendCooldownSeconds > 0 || loading}
                onClick={() =>
                  handleResendOtp(mode === 'verify_otp' ? 'signup' : 'reset_password')
                }
                className="inline-flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors tabular-nums whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {resendCooldownSeconds > 0
                    ? `${dict.resendWait} ${resendCooldownSeconds}s`
                    : dict.resendCode}
                </span>
              </button>
            </div>
          )}

          {/* Secondary Auth Navigation Links */}
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-sm">
            {mode === 'login' ? (
              <>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="min-h-[44px] text-emerald-700 dark:text-emerald-400 hover:underline font-medium whitespace-nowrap"
                >
                  {dict.noAccount}
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('forgot_password')}
                  className="min-h-[44px] text-slate-600 dark:text-slate-400 hover:underline whitespace-nowrap"
                >
                  {dict.forgotPassword}
                </button>
              </>
            ) : mode === 'signup' ? (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="min-h-[44px] text-emerald-700 dark:text-emerald-400 hover:underline font-medium whitespace-nowrap"
              >
                {dict.hasAccount}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="min-h-[44px] text-emerald-700 dark:text-emerald-400 hover:underline font-medium whitespace-nowrap"
              >
                {dict.backToLogin}
              </button>
            )}
          </div>
        </section>

        {/* Cross-Platform Auth & Calls Readiness Overview */}
        <section className="lg:col-span-6 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white text-balance">
              {lang === 'ar' ? (
                <>
                  نظام دخول موحّد على{' '}
                  <bdi dir="ltr">iPhone</bdi> و <bdi dir="ltr">Android</bdi> والويب
                </>
              ) : (
                'Unified Access Across Web, iOS & Android'
              )}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {lang === 'ar' ? (
                <>
                  حساب واحد آمن ومستمر في{' '}
                  <bdi dir="ltr">Connect</bdi> للمراسلة الفورية والمكالمات الصوتية والمرئية عالية الجودة.
                </>
              ) : (
                'One persistent, verified Connect account ready for instant messaging and high-definition audio and video calls.'
              )}
            </p>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900">
            <div className="p-4 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {lang === 'ar'
                    ? 'تشفير متقدم وحماية الجلسات'
                    : 'Encrypted Passwords & Persistent Sessions'}
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {lang === 'ar'
                    ? 'تشفير قوي لكلمات المرور مع استمرار تسجيل الدخول بأمان وإمكانية إلغاء الجلسة وحذف الحساب في أي وقت.'
                    : 'Modern password protection, persistent sign-in across devices, instant session revocation, and full account deletion.'}
                </p>
              </div>
            </div>

            <div className="p-4 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {lang === 'ar'
                    ? 'تحقق بريدي فوري برمز من 6 أرقام'
                    : '6-Digit Email Verification Code'}
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {lang === 'ar'
                    ? 'تأكيد البريد الإلكتروني واستعادة كلمة المرور برمز صالح لمدة 5 دقائق للاستخدام مرة واحدة مع مهلة إعادة إرسال 30 ثانية.'
                    : 'Verify emails and reset passwords with single-use 5-minute codes, 30-second resend cooldown, and attempt limits.'}
                </p>
              </div>
            </div>

            <div className="p-4 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {lang === 'ar' ? (
                    <>
                      دخول سريع عبر <bdi dir="ltr">Google</bdi> و <bdi dir="ltr">Apple</bdi>
                    </>
                  ) : (
                    'Verified Google & Apple Private Relay Sign-In'
                  )}
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {lang === 'ar' ? (
                    <>
                      ربط آمن وموثّق عبر الخادم لحسابات <bdi dir="ltr">Google</bdi> و <bdi dir="ltr">Apple</bdi> مع دعم كامل لإخفاء البريد الإلكتروني.
                    </>
                  ) : (
                    'Server-verified Google OAuth and Sign in with Apple with complete support for Apple Private Email Relay.'
                  )}
                </p>
              </div>
            </div>

            <div className="p-4 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                <PhoneCall className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {lang === 'ar' ? (
                    <>
                      جاهز لمكالمات <bdi dir="ltr">Connect</bdi> الصوتية والمرئية
                    </>
                  ) : (
                    'Integrated with Connect Voice & Video Calls'
                  )}
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {lang === 'ar'
                    ? 'بمجرد تسجيل الدخول تبدأ المراسلة الفورية وإجراء المكالمات الصوتية والمرئية فوراً وبموثوقية كاملة.'
                    : 'Your authenticated session connects directly into live chats, friend requests, and voice/video calling rooms.'}
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
