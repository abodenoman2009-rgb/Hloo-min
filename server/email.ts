import nodemailer from 'nodemailer';

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super(
      'SMTP email service is not configured on the server. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM in environment secrets.'
    );
    this.name = 'SmtpNotConfiguredError';
  }
}

export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim()
  );
}

export async function sendVerificationOtpEmail(params: {
  to: string;
  fullName?: string;
  otp: string;
  purpose: 'signup' | 'reset_password';
}): Promise<void> {
  if (!isSmtpConfigured()) {
    throw new SmtpNotConfiguredError();
  }

  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASS!.trim();
  const from = (process.env.SMTP_FROM || user).trim();

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const isReset = params.purpose === 'reset_password';
  const subject = isReset
    ? 'Connect - رمز إعادة تعيين كلمة المرور / Password Reset Code'
    : 'Connect - رمز التحقق من البريد الإلكتروني / Email Verification Code';

  const greetingName = params.fullName?.trim() || params.to.split('@')[0];

  const textBody = [
    `مرحباً ${greetingName} / Hello ${greetingName},`,
    '',
    isReset
      ? `رمز إعادة تعيين كلمة المرور في Connect هو: ${params.otp}`
      : `رمز التحقق من بريدك الإلكتروني في Connect هو: ${params.otp}`,
    '',
    isReset
      ? `Your Connect password reset code is: ${params.otp}`
      : `Your Connect email verification code is: ${params.otp}`,
    '',
    'الرمز صالح لمدة 5 دقائق وللاستخدام مرة واحدة فقط.',
    'This code expires in 5 minutes and can only be used once.',
  ].join('\n');

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #f8fafc; color: #0f172a;">
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 28px;">
        <h1 style="margin: 0 0 12px; font-size: 20px; color: #047857;">Connect · كونكت</h1>
        <p dir="rtl" style="margin: 0 0 12px; font-size: 15px; line-height: 1.6;">
          ${isReset ? 'استخدم رمز التحقق التالي لإعادة تعيين كلمة المرور لحسابك:' : 'استخدم رمز التحقق التالي لتأكيد بريدك الإلكتروني في Connect:'}
        </p>
        <div style="margin: 20px 0; padding: 16px; background: #f1f5f9; border-radius: 12px; text-align: center; font-size: 30px; font-weight: 700; letter-spacing: 8px; font-family: monospace; color: #0f172a;">
          ${params.otp}
        </div>
        <p style="margin: 0 0 10px; font-size: 14px; color: #334155;">
          ${isReset ? 'Use this 6-digit code to reset your Connect password.' : 'Use this 6-digit code to verify your Connect email address.'}
        </p>
        <p dir="rtl" style="margin: 0; font-size: 13px; color: #64748b;">
          الرمز صالح لمدة 5 دقائق فقط ولا يمكن استخدامه أكثر من مرة.
        </p>
        <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">
          Valid for 5 minutes · Single-use only.
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from,
    to: params.to,
    subject,
    text: textBody,
    html: htmlBody,
  });
}
