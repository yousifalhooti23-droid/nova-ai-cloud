import { badRequest, unauthorized } from '../lib/errors.js';

export interface VerifiedGoogleProfile {
  email: string;
  name: string;
  sub: string;
}

/**
 * Verifies a Google Identity Services ID token (`credential` JWT) directly with
 * Google's official tokeninfo endpoint (`https://oauth2.googleapis.com/tokeninfo`).
 * Enforces `aud === clientId`, `iss` match, `email_verified === 'true'`, and non-expired `exp`.
 */
export async function verifyGoogleIdToken(credential: string, expectedClientId: string): Promise<VerifiedGoogleProfile> {
  if (!credential || credential.length < 40 || credential.length > 4096) {
    throw badRequest('رمز مصادقة Google غير صالح.', 'invalid_google_token');
  }
  const cleanClientId = expectedClientId.trim();
  if (!cleanClientId) {
    throw badRequest('لم يتم تفعيل الدخول عبر Google بعد.', 'google_not_configured');
  }

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential.trim())}`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) {
    throw unauthorized('تعذّر التحقق من حساب Google. يرجى المحاولة مرة أخرى.', 'invalid_google_token');
  }

  const payload = (await res.json()) as {
    iss?: string;
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    exp?: string;
  };

  if (payload.aud !== cleanClientId) {
    throw unauthorized('معرّف تطبيق Google غير مطابق (aud mismatch).', 'invalid_google_aud');
  }
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw unauthorized('مصدر رمز Google غير موثوق.', 'invalid_google_iss');
  }
  if (String(payload.email_verified) !== 'true' || !payload.email) {
    throw unauthorized('يجب أن يكون حساب Google موثّق البريد الإلكتروني.', 'google_email_unverified');
  }
  const expSec = Number(payload.exp ?? 0);
  if (!expSec || expSec * 1000 <= Date.now()) {
    throw unauthorized('انتهت صلاحية جلسة مصادقة Google. حاول مجدداً.', 'google_token_expired');
  }

  const email = payload.email.trim().toLowerCase();
  const fallbackName = email.split('@')[0] || 'User';
  return {
    email,
    name: (payload.name?.trim() || fallbackName).slice(0, 60),
    sub: String(payload.sub ?? email),
  };
}
