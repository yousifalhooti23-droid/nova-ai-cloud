import type {
  AdminPendingOtpSummary,
  AdminSecurityConfigResponse,
  AdminSecurityConfigUpdateRequest,
  AdminUserSummary,
  AuthPublicConfigResponse,
  AuthUser,
  QuotaStatus,
} from '@nova/shared';
import { maskSecretSafe, newId, nowIso, truncate } from '@nova/shared';
import { badRequest, forbidden, HttpError, unauthorized } from '../lib/errors.js';
import type { Store } from '../storage/types.js';
import {
  generateNumericOtp,
  generateSessionToken,
  hashOtpCode,
  hashPassword,
  randomHex,
  sha256HexToken,
  verifyOtpCode,
  verifyPassword,
} from './crypto.js';
import { canonicalizeEmail, validateRealEmail } from './email-guard.js';
import { verifyGoogleIdToken } from './google.js';
import { isMailerConfigured, sendOtpEmail, type MailerConfig } from './mailer.js';
import type { AuthRepo, StoredSecurityConfig, StoredUser } from './repo.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const WEEK_LOCKOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 full days (1 week)
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_FAILURES = 8;
const REGISTER_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTER_MAX_PER_IP = 4;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const OTP_MAX_ATTEMPTS = 5;

export interface AuthServiceOptions {
  runtime: 'workers' | 'node';
  defaultDailyQuota: number;
  ownerEmail?: string;
  ownerInitialPassword?: string;
  ownerDisplayName?: string;
  otpRequiredByDefault?: boolean;
  skipDnsMxCheck?: boolean;
  envMailer?: MailerConfig;
  envGoogleClientId?: string;
  onOtpGenerated?: (email: string, code: string) => void;
}

export type RegisterResult =
  | {
      otpRequired: false;
      user: AuthUser;
      token: string;
    }
  | {
      otpRequired: true;
      pendingEmail: string;
      expiresInSec: number;
      delivery: 'email' | 'pending_owner';
      message: string;
    };

export class AuthService {
  constructor(
    public readonly repo: AuthRepo,
    private opts: AuthServiceOptions,
  ) {}

  /**
   * Resolve effective security configuration (persisted Owner settings merged with env fallbacks).
   */
  private async effectiveSecurityConfig(): Promise<{
    stored: StoredSecurityConfig;
    otpRequired: boolean;
    strictTrustedDomainsOnly: boolean;
    mailer: MailerConfig | null;
    googleClientId: string | null;
  }> {
    const stored = await this.repo.getSecurityConfig();
    const otpRequired =
      this.opts.otpRequiredByDefault === false ? false : Boolean(stored.otpRequired);

    let mailer: MailerConfig | null = null;
    if (stored.mailerProvider !== 'none' && stored.senderEmail?.trim() && stored.mailerSecret?.trim()) {
      mailer = {
        provider: stored.mailerProvider,
        senderEmail: stored.senderEmail.trim(),
        senderName: stored.senderName?.trim() || 'NOVA AI Cloud',
        secret: stored.mailerSecret.trim(),
      };
    } else if (isMailerConfigured(this.opts.envMailer)) {
      mailer = this.opts.envMailer;
    }

    const googleClientId = stored.googleClientId?.trim() || this.opts.envGoogleClientId?.trim() || null;
    return {
      stored,
      otpRequired,
      strictTrustedDomainsOnly: Boolean(stored.strictTrustedDomainsOnly),
      mailer,
      googleClientId,
    };
  }

  async getPublicConfig(): Promise<AuthPublicConfigResponse> {
    const eff = await this.effectiveSecurityConfig();
    return {
      otpRequired: eff.otpRequired,
      mailerConfigured: Boolean(eff.mailer) || Boolean(this.opts.onOtpGenerated),
      strictTrustedDomainsOnly: eff.strictTrustedDomainsOnly,
      googleClientId: eff.googleClientId,
    };
  }

  /**
   * Pre-seed or upgrade the designated platform owner account so public sign-up
   * never needs any privilege-escalation path, and claim pre-existing legacy data.
   */
  async bootstrapOwner(baseStore: Store): Promise<void> {
    const email = this.opts.ownerEmail?.trim().toLowerCase();
    if (!email) return;

    let owner = await this.repo.getUserByEmail(email);
    if (!owner && this.opts.ownerInitialPassword) {
      const { hashHex, saltHex } = await hashPassword(this.opts.ownerInitialPassword);
      const now = nowIso();
      owner = {
        id: newId('usr'),
        email,
        displayName: this.opts.ownerDisplayName?.trim() || 'Yousif (Owner)',
        passwordHash: hashHex,
        passwordSalt: saltHex,
        role: 'owner',
        quotaLimit: 0,
        quotaUsed: 0,
        quotaDay: now.slice(0, 10),
        quotaLockedUntil: null,
        createdAt: now,
        lastLoginAt: now,
      };
      await this.repo.createUser(owner);
    } else if (owner && owner.role !== 'owner') {
      owner = await this.repo.updateUser(owner.id, { role: 'owner', quotaLockedUntil: null });
    }

    if (owner) {
      await this.claimUnownedLegacyData(baseStore, owner.id);
    }
  }

  private async claimUnownedLegacyData(baseStore: Store, ownerId: string): Promise<void> {
    try {
      const [convs, projects, tasks] = await Promise.all([
        baseStore.listConversations({ includeArchived: true, limit: 500 }),
        baseStore.listProjects(),
        baseStore.listTasks(),
      ]);
      for (const c of convs) {
        if (!(await this.repo.hasAnyOwner('conversation', c.id))) {
          await this.repo.assignResource('conversation', c.id, ownerId);
        }
      }
      for (const p of projects) {
        if (!(await this.repo.hasAnyOwner('project', p.id))) {
          await this.repo.assignResource('project', p.id, ownerId);
        }
      }
      for (const t of tasks) {
        if (!(await this.repo.hasAnyOwner('task', t.id))) {
          await this.repo.assignResource('task', t.id, ownerId);
        }
      }
    } catch {
      /* ignore migration issues on empty stores */
    }
  }

  private async normalizeUserQuota(user: StoredUser): Promise<StoredUser> {
    if (user.role === 'owner') return user;
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    if (user.quotaLockedUntil) {
      const unlockTs = Date.parse(user.quotaLockedUntil);
      if (!Number.isNaN(unlockTs) && now >= unlockTs) {
        const refreshed = await this.repo.updateUser(user.id, {
          quotaUsed: 0,
          quotaDay: today,
          quotaLockedUntil: null,
        });
        return refreshed ?? user;
      }
      return user;
    }

    if (user.quotaDay !== today) {
      const refreshed = await this.repo.updateUser(user.id, {
        quotaUsed: 0,
        quotaDay: today,
      });
      return refreshed ?? user;
    }

    return user;
  }

  computeQuotaStatus(user: StoredUser): QuotaStatus {
    if (user.role === 'owner') {
      return {
        unlimited: true,
        used: 0,
        limit: 0,
        remaining: null,
        locked: false,
        lockedUntil: null,
      };
    }
    const limit = Math.max(1, user.quotaLimit || this.opts.defaultDailyQuota);
    const locked = Boolean(user.quotaLockedUntil && Date.parse(user.quotaLockedUntil) > Date.now());
    const used = locked ? limit : Math.min(limit, Math.max(0, user.quotaUsed));
    return {
      unlimited: false,
      used,
      limit,
      remaining: locked ? 0 : Math.max(0, limit - used),
      locked,
      lockedUntil: locked ? user.quotaLockedUntil : null,
    };
  }

  toPublicUser(user: StoredUser): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      quota: this.computeQuotaStatus(user),
      createdAt: user.createdAt,
    };
  }

  private formatWeeklyLockoutMessage(limit: number, lockedUntil: string): string {
    const msLeft = Math.max(0, Date.parse(lockedUntil) - Date.now());
    const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    const dateStr = lockedUntil.slice(0, 10);
    const dayWord = daysLeft === 1 ? 'يوم واحد' : daysLeft === 2 ? 'يومين' : `${daysLeft} أيام`;
    return `⛔ خلاص انتهى حدّك اليومي بالكامل (${limit}/${limit})! ما فيه رصيد متاح حالياً — يتجدد حدّك تلقائياً بعد أسبوع (متبقي ${dayWord}، بتاريخ ${dateStr}).`;
  }

  async consumeQuota(userId: string, cost = 1): Promise<QuotaStatus> {
    const rawUser = await this.repo.getUserById(userId);
    if (!rawUser) throw unauthorized('يرجى تسجيل الدخول للمتابعة.', 'auth_required');
    if (rawUser.role === 'owner') {
      return this.computeQuotaStatus(rawUser);
    }

    const user = await this.normalizeUserQuota(rawUser);
    const limit = Math.max(1, user.quotaLimit || this.opts.defaultDailyQuota);

    if (user.quotaLockedUntil && Date.parse(user.quotaLockedUntil) > Date.now()) {
      throw new HttpError(429, this.formatWeeklyLockoutMessage(limit, user.quotaLockedUntil), 'quota_exhausted_weekly');
    }

    if (user.quotaUsed >= limit) {
      const lockedUntil = new Date(Date.now() + WEEK_LOCKOUT_MS).toISOString();
      await this.repo.updateUser(user.id, { quotaUsed: limit, quotaLockedUntil: lockedUntil });
      throw new HttpError(429, this.formatWeeklyLockoutMessage(limit, lockedUntil), 'quota_exhausted_weekly');
    }

    const today = new Date().toISOString().slice(0, 10);
    const nextUsed = Math.min(limit, user.quotaUsed + Math.max(1, cost));
    const justExhausted = nextUsed >= limit;
    const lockedUntil = justExhausted ? new Date(Date.now() + WEEK_LOCKOUT_MS).toISOString() : null;

    const updated = await this.repo.updateUser(user.id, {
      quotaUsed: nextUsed,
      quotaDay: today,
      quotaLockedUntil: lockedUntil,
    });
    return this.computeQuotaStatus(updated ?? { ...user, quotaUsed: nextUsed, quotaLockedUntil: lockedUntil });
  }

  /**
   * Step 1 of Registration:
   * - Validates real email (blocks fake domains, non-MX domains, 250+ temp-mail services, +aliases, Gmail dot-duplicates)
   * - Generates a 6-digit cryptographic OTP & sends it to the user's real inbox!
   * - Never issues an active account or session until the 6-digit OTP is verified!
   */
  async register(input: { email: string; password: string; displayName: string; clientIp: string }): Promise<RegisterResult> {
    const password = input.password ?? '';
    const rawName = (input.displayName ?? '').replace(/[\u0000-\u001F<>]/g, '').trim();

    if (password.length < 8 || password.length > 128) {
      throw badRequest('كلمة المرور يجب أن تكون 8 أحرف على الأقل لحماية حسابك.', 'weak_password');
    }
    if (rawName.length < 2) {
      throw badRequest('يرجى كتابة اسم العرض الحقيقي (حرفين على الأقل).', 'invalid_name');
    }

    const eff = await this.effectiveSecurityConfig();
    const { email, canonicalEmail } = await validateRealEmail(input.email, {
      strictTrustedDomainsOnly: eff.strictTrustedDomainsOnly,
      skipDnsMxCheck: this.opts.skipDnsMxCheck,
    });

    const ipHash = await sha256HexToken(`reg_ip:${input.clientIp || 'unknown'}`);
    const allowedIp = await this.repo.consumeRateLimit(`reg:${ipHash}`, REGISTER_MAX_PER_IP, REGISTER_WINDOW_MS);
    if (!allowedIp) {
      throw new HttpError(429, 'تم الوصول للحد الأقصى من طلبات إنشاء الحسابات من هذه الشبكة اليوم.', 'register_rate_limited');
    }

    if (this.opts.ownerEmail && canonicalEmail === canonicalizeEmail(this.opts.ownerEmail)) {
      throw forbidden('هذا البريد مخصص لمالك المنصة فقط. يرجى تسجيل الدخول.', 'owner_email_reserved');
    }

    const existing = (await this.repo.getUserByEmail(email)) ?? (await this.repo.getUserByCanonicalEmail(canonicalEmail));
    if (existing) {
      throw badRequest('هذا البريد الإلكتروني مسجّل مسبقاً. يرجى تسجيل الدخول.', 'email_taken');
    }

    const { hashHex: pwHash, saltHex: pwSalt } = await hashPassword(password);

    if (!eff.otpRequired) {
      const now = nowIso();
      const stored: StoredUser = {
        id: newId('usr'),
        email,
        displayName: truncate(rawName, 60),
        passwordHash: pwHash,
        passwordSalt: pwSalt,
        role: 'user',
        quotaLimit: this.opts.defaultDailyQuota,
        quotaUsed: 0,
        quotaDay: now.slice(0, 10),
        quotaLockedUntil: null,
        createdAt: now,
        lastLoginAt: now,
      };
      await this.repo.createUser(stored);
      const token = await this.issueSession(stored.id);
      return { otpRequired: false, user: this.toPublicUser(stored), token };
    }

    // Generate 6-digit OTP & store salted SHA-256 digest only
    const code = generateNumericOtp();
    const { hashHex: otpHash, saltHex: otpSalt } = await hashOtpCode(code);
    const nowMs = Date.now();
    await this.repo.upsertPendingRegistration({
      email,
      canonicalEmail,
      displayName: truncate(rawName, 60),
      passwordHash: pwHash,
      passwordSalt: pwSalt,
      otpHash,
      otpSalt,
      attempts: 0,
      expiresAt: new Date(nowMs + OTP_TTL_MS).toISOString(),
      resendAfter: new Date(nowMs + OTP_RESEND_COOLDOWN_MS).toISOString(),
      createdAt: new Date(nowMs).toISOString(),
    });

    this.opts.onOtpGenerated?.(email, code);

    if (eff.mailer) {
      try {
        await sendOtpEmail(eff.mailer, {
          toEmail: email,
          displayName: truncate(rawName, 60),
          code,
          expiresMinutes: 10,
          runtime: this.opts.runtime,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new HttpError(
          502,
          `تعذّر إرسال رمز التحقق (OTP) إلى بريدك حالياً: ${reason}`,
          'otp_send_failed',
        );
      }
      return {
        otpRequired: true,
        pendingEmail: email,
        expiresInSec: Math.round(OTP_TTL_MS / 1000),
        delivery: 'email',
        message: `تم إرسال رمز تحقق (OTP) مكوّن من 6 أرقام إلى ${email}. أدخله لتفعيل حسابك.`,
      };
    }

    if (this.opts.onOtpGenerated) {
      return {
        otpRequired: true,
        pendingEmail: email,
        expiresInSec: Math.round(OTP_TTL_MS / 1000),
        delivery: 'email',
        message: `تم إرسال رمز التحقق إلى ${email}.`,
      };
    }

    // Fail-closed when mailer is not configured yet: NEVER allow fake unverified signup!
    return {
      otpRequired: true,
      pendingEmail: email,
      expiresInSec: Math.round(OTP_TTL_MS / 1000),
      delivery: 'pending_owner',
      message:
        'تم تسجيل طلبك بانتظار التحقق الأمني (OTP). يرجى من مالك المنصة تفعيل بريد إرسال الرموز من الإعدادات أو اعتماد حسابك.',
    };
  }

  /**
   * Step 2 of Registration: Verify the 6-digit OTP and activate the account.
   */
  async verifyRegistrationOtp(input: { email: string; code: string; clientIp: string }): Promise<{ user: AuthUser; token: string }> {
    const email = (input.email ?? '').trim().toLowerCase();
    const code = (input.code ?? '').replace(/\s+/g, '');
    if (!email || !/^\d{6}$/.test(code)) {
      throw badRequest('يرجى إدخال رمز التحقق المكوّن من 6 أرقام بشكل صحيح.', 'invalid_otp_format');
    }

    const ipHash = await sha256HexToken(`otp_ip:${input.clientIp || 'unknown'}`);
    const ipAllowed = await this.repo.consumeRateLimit(`otp_verify:${ipHash}`, 12, LOGIN_WINDOW_MS);
    if (!ipAllowed) {
      throw new HttpError(429, 'محاولات تحقق كثيرة جداً. يرجى الانتظار 15 دقيقة.', 'otp_rate_limited');
    }

    const pending = await this.repo.getPendingRegistration(email);
    if (!pending) {
      throw badRequest('انتهت صلاحية رمز التحقق أو لا يوجد طلب تسجيل لهذا البريد. أعد التسجيل.', 'otp_expired');
    }

    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      await this.repo.deletePendingRegistration(email);
      throw unauthorized('تم تجاوز الحد الأقصى لمحاولات إدخال الرمز (5 محاولات). يرجى طلب رمز جديد.', 'otp_max_attempts');
    }

    const valid = await verifyOtpCode(code, pending.otpHash, pending.otpSalt);
    if (!valid) {
      const usedAttempts = await this.repo.incrementPendingAttempts(email);
      const left = Math.max(0, OTP_MAX_ATTEMPTS - usedAttempts);
      if (left === 0) {
        await this.repo.deletePendingRegistration(email);
        throw unauthorized('رمز التحقق غير صحيح وتم إلغاء الرمز لحماية البريد. اطلب رمزاً جديداً.', 'otp_invalid');
      }
      throw unauthorized(`رمز التحقق (OTP) غير صحيح. المحاولات المتبقية: ${left}.`, 'otp_invalid');
    }

    await this.repo.deletePendingRegistration(email);

    const duplicate =
      (await this.repo.getUserByEmail(pending.email)) ??
      (await this.repo.getUserByCanonicalEmail(pending.canonicalEmail));
    if (duplicate) {
      throw badRequest('تم تفعيل هذا البريد مسبقاً. يرجى تسجيل الدخول.', 'email_taken');
    }

    const now = nowIso();
    const stored: StoredUser = {
      id: newId('usr'),
      email: pending.email,
      displayName: pending.displayName,
      passwordHash: pending.passwordHash,
      passwordSalt: pending.passwordSalt,
      role: 'user',
      quotaLimit: this.opts.defaultDailyQuota,
      quotaUsed: 0,
      quotaDay: now.slice(0, 10),
      quotaLockedUntil: null,
      createdAt: now,
      lastLoginAt: now,
    };
    await this.repo.createUser(stored);

    const token = await this.issueSession(stored.id);
    return { user: this.toPublicUser(stored), token };
  }

  /**
   * Resend a fresh 6-digit OTP after the 60-second cooldown.
   */
  async resendRegistrationOtp(input: { email: string; clientIp: string }): Promise<{ expiresInSec: number; delivery: 'email' | 'pending_owner'; message: string }> {
    const email = (input.email ?? '').trim().toLowerCase();
    const pending = await this.repo.getPendingRegistration(email);
    if (!pending) {
      throw badRequest('لا يوجد طلب تسجيل معلّق لهذا البريد. يرجى إدخال بيانات التسجيل مجدداً.', 'otp_expired');
    }

    const waitMs = Date.parse(pending.resendAfter) - Date.now();
    if (waitMs > 0) {
      const sec = Math.ceil(waitMs / 1000);
      throw new HttpError(429, `يرجى الانتظار ${sec} ثانية قبل طلب إرسال رمز جديد.`, 'otp_cooldown');
    }

    const code = generateNumericOtp();
    const { hashHex: otpHash, saltHex: otpSalt } = await hashOtpCode(code);
    const nowMs = Date.now();
    await this.repo.upsertPendingRegistration({
      ...pending,
      otpHash,
      otpSalt,
      attempts: 0,
      expiresAt: new Date(nowMs + OTP_TTL_MS).toISOString(),
      resendAfter: new Date(nowMs + OTP_RESEND_COOLDOWN_MS).toISOString(),
    });

    this.opts.onOtpGenerated?.(email, code);

    const eff = await this.effectiveSecurityConfig();
    if (eff.mailer) {
      await sendOtpEmail(eff.mailer, {
        toEmail: email,
        displayName: pending.displayName,
        code,
        expiresMinutes: 10,
        runtime: this.opts.runtime,
      });
      return {
        expiresInSec: Math.round(OTP_TTL_MS / 1000),
        delivery: 'email',
        message: `تم إرسال رمز تحقق جديد (6 أرقام) إلى ${email}.`,
      };
    }

    return {
      expiresInSec: Math.round(OTP_TTL_MS / 1000),
      delivery: this.opts.onOtpGenerated ? 'email' : 'pending_owner',
      message: 'تم تجديد رمز التحقق.',
    };
  }

  /**
   * Verified Sign-In / Sign-Up via official Google Account (`email_verified === true`).
   */
  async loginWithGoogle(input: { credential: string; clientIp: string }): Promise<{ user: AuthUser; token: string }> {
    const eff = await this.effectiveSecurityConfig();
    if (!eff.googleClientId) {
      throw badRequest('تسجيل الدخول عبر Google غير مفعّل حالياً.', 'google_not_configured');
    }

    const profile = await verifyGoogleIdToken(input.credential, eff.googleClientId);
    const canonical = canonicalizeEmail(profile.email);

    let existing =
      (await this.repo.getUserByEmail(profile.email)) ??
      (await this.repo.getUserByCanonicalEmail(canonical));

    if (!existing) {
      const ipHash = await sha256HexToken(`reg_ip:${input.clientIp || 'unknown'}`);
      const allowedIp = await this.repo.consumeRateLimit(`reg:${ipHash}`, REGISTER_MAX_PER_IP, REGISTER_WINDOW_MS);
      if (!allowedIp) {
        throw new HttpError(429, 'تم الوصول للحد الأقصى من إنشاء الحسابات من هذه الشبكة اليوم.', 'register_rate_limited');
      }

      const isOwner = Boolean(this.opts.ownerEmail && canonical === canonicalizeEmail(this.opts.ownerEmail));
      const { hashHex, saltHex } = await hashPassword(randomHex(32));
      const now = nowIso();
      existing = {
        id: newId('usr'),
        email: profile.email,
        displayName: profile.name,
        passwordHash: hashHex,
        passwordSalt: saltHex,
        role: isOwner ? 'owner' : 'user',
        quotaLimit: isOwner ? 0 : this.opts.defaultDailyQuota,
        quotaUsed: 0,
        quotaDay: now.slice(0, 10),
        quotaLockedUntil: null,
        createdAt: now,
        lastLoginAt: now,
      };
      await this.repo.createUser(existing);
    }

    const normalized = await this.normalizeUserQuota(existing);
    const updated = (await this.repo.updateUser(normalized.id, { lastLoginAt: nowIso() })) ?? normalized;
    const token = await this.issueSession(updated.id);
    return { user: this.toPublicUser(updated), token };
  }

  async login(input: { email: string; password: string; clientIp: string }): Promise<{ user: AuthUser; token: string }> {
    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';
    if (!email || !password) {
      throw badRequest('يرجى إدخال البريد الإلكتروني وكلمة المرور.', 'missing_credentials');
    }

    const ipHash = await sha256HexToken(`login_ip:${input.clientIp || 'unknown'}`);
    const emailHash = await sha256HexToken(`login_em:${email}`);
    const [ipOk, emailOk] = await Promise.all([
      this.repo.consumeRateLimit(`login_ip:${ipHash}`, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS),
      this.repo.consumeRateLimit(`login_em:${emailHash}`, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS),
    ]);
    if (!ipOk || !emailOk) {
      throw new HttpError(429, 'تم إيقاف محاولات الدخول مؤقتاً لمدة 15 دقيقة لحماية الحساب من التخمين.', 'login_rate_limited');
    }

    const existing = await this.repo.getUserByEmail(email);
    if (!existing) {
      await hashPassword(password, '00112233445566778899aabbccddeeff');
      const pending = await this.repo.getPendingRegistration(email);
      if (pending) {
        throw unauthorized('هذا الحساب لم يتم تفعيله برمز التحقق (OTP) بعد. أكمل التحقق من بريدك أولاً.', 'otp_pending');
      }
      throw unauthorized('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'invalid_credentials');
    }

    const valid = await verifyPassword(password, existing.passwordHash, existing.passwordSalt);
    if (!valid) {
      throw unauthorized('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'invalid_credentials');
    }

    await Promise.all([
      this.repo.resetRateLimit(`login_ip:${ipHash}`),
      this.repo.resetRateLimit(`login_em:${emailHash}`),
    ]);

    const normalized = await this.normalizeUserQuota(existing);
    const updated = (await this.repo.updateUser(normalized.id, { lastLoginAt: nowIso() })) ?? normalized;
    const token = await this.issueSession(updated.id);
    return { user: this.toPublicUser(updated), token };
  }

  async authenticateToken(rawToken: string | undefined | null): Promise<{ user: AuthUser; tokenHash: string } | null> {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 200) {
      return null;
    }
    const tokenHash = await sha256HexToken(rawToken.trim());
    const session = await this.repo.getSession(tokenHash);
    if (!session) return null;

    const rawUser = await this.repo.getUserById(session.userId);
    if (!rawUser) {
      await this.repo.deleteSession(tokenHash);
      return null;
    }
    const normalized = await this.normalizeUserQuota(rawUser);
    return { user: this.toPublicUser(normalized), tokenHash };
  }

  async logout(rawToken: string | undefined | null): Promise<void> {
    if (!rawToken) return;
    const tokenHash = await sha256HexToken(rawToken.trim());
    await this.repo.deleteSession(tokenHash);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, keepTokenHash?: string): Promise<void> {
    if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
      throw badRequest('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.', 'weak_password');
    }
    const user = await this.repo.getUserById(userId);
    if (!user) throw unauthorized('الحساب غير موجود.', 'auth_required');

    const ok = await verifyPassword(currentPassword ?? '', user.passwordHash, user.passwordSalt);
    if (!ok) {
      throw unauthorized('كلمة المرور الحالية غير صحيحة.', 'invalid_credentials');
    }

    const { hashHex, saltHex } = await hashPassword(newPassword);
    await this.repo.updateUser(userId, { passwordHash: hashHex, passwordSalt: saltHex });
    await this.repo.deleteUserSessions(userId, keepTokenHash);
  }

  /* --------------------------------------------------- Owner Administration */

  async getSecurityConfigForOwner(): Promise<AdminSecurityConfigResponse> {
    const eff = await this.effectiveSecurityConfig();
    const secretVal = eff.stored.mailerSecret || this.opts.envMailer?.secret || '';
    const provider = eff.stored.mailerProvider !== 'none' ? eff.stored.mailerProvider : (this.opts.envMailer?.provider ?? 'none');
    const senderEmail = eff.stored.senderEmail || this.opts.envMailer?.senderEmail || this.opts.ownerEmail || '';
    return {
      otpRequired: eff.otpRequired,
      strictTrustedDomainsOnly: eff.strictTrustedDomainsOnly,
      mailerProvider: provider,
      senderEmail,
      senderName: eff.stored.senderName || 'NOVA AI Cloud',
      hasSecret: Boolean(secretVal),
      maskedSecret: secretVal ? maskSecretSafe(secretVal.replace(/\s+/g, '')) : undefined,
      googleClientId: eff.googleClientId ?? '',
    };
  }

  async updateSecurityConfigAsOwner(patch: AdminSecurityConfigUpdateRequest): Promise<AdminSecurityConfigResponse> {
    const cur = await this.repo.getSecurityConfig();
    const nextPatch: Partial<StoredSecurityConfig> = {};
    if (patch.otpRequired !== undefined) nextPatch.otpRequired = Boolean(patch.otpRequired);
    if (patch.strictTrustedDomainsOnly !== undefined) nextPatch.strictTrustedDomainsOnly = Boolean(patch.strictTrustedDomainsOnly);
    if (patch.mailerProvider !== undefined) nextPatch.mailerProvider = patch.mailerProvider;
    if (patch.senderEmail !== undefined) nextPatch.senderEmail = patch.senderEmail.trim().toLowerCase();
    if (patch.senderName !== undefined) nextPatch.senderName = patch.senderName.trim() || 'NOVA AI Cloud';
    if (patch.clearSecret) nextPatch.mailerSecret = '';
    else if (typeof patch.secret === 'string' && patch.secret.trim()) {
      nextPatch.mailerSecret =
        (patch.mailerProvider ?? cur.mailerProvider) === 'gmail'
          ? patch.secret.replace(/\s+/g, '')
          : patch.secret.trim();
    }
    if (patch.googleClientId !== undefined) nextPatch.googleClientId = patch.googleClientId.trim();

    await this.repo.saveSecurityConfig(nextPatch);
    return this.getSecurityConfigForOwner();
  }

  async sendTestOtpAsOwner(toEmail: string): Promise<void> {
    const eff = await this.effectiveSecurityConfig();
    if (!eff.mailer) {
      throw badRequest('يرجى حفظ إعدادات البريد (مثل Gmail App Password) أولاً قبل الاختبار.', 'mailer_not_configured');
    }
    await sendOtpEmail(eff.mailer, {
      toEmail: toEmail.trim().toLowerCase(),
      displayName: 'Yousif (اختبار المالك)',
      code: generateNumericOtp(),
      expiresMinutes: 10,
      runtime: this.opts.runtime,
    });
  }

  async listPendingForOwner(): Promise<AdminPendingOtpSummary[]> {
    const list = await this.repo.listPendingRegistrations();
    return list.map((p) => ({
      email: p.email,
      displayName: p.displayName,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      attempts: p.attempts,
    }));
  }

  async approvePendingAsOwner(email: string): Promise<AdminUserSummary> {
    const clean = email.trim().toLowerCase();
    const pending = await this.repo.getPendingRegistration(clean);
    if (!pending) throw badRequest('الطلب غير موجود أو انتهت صلاحيته.', 'not_found');
    await this.repo.deletePendingRegistration(clean);

    const now = nowIso();
    const stored: StoredUser = {
      id: newId('usr'),
      email: pending.email,
      displayName: pending.displayName,
      passwordHash: pending.passwordHash,
      passwordSalt: pending.passwordSalt,
      role: 'user',
      quotaLimit: this.opts.defaultDailyQuota,
      quotaUsed: 0,
      quotaDay: now.slice(0, 10),
      quotaLockedUntil: null,
      createdAt: now,
      lastLoginAt: now,
    };
    await this.repo.createUser(stored);
    return {
      id: stored.id,
      email: stored.email,
      displayName: stored.displayName,
      role: stored.role,
      quota: this.computeQuotaStatus(stored),
      createdAt: stored.createdAt,
      lastLoginAt: stored.lastLoginAt,
    };
  }

  async listUsersForOwner(): Promise<AdminUserSummary[]> {
    const all = await this.repo.listUsers();
    const out: AdminUserSummary[] = [];
    for (const u of all) {
      const normalized = await this.normalizeUserQuota(u);
      out.push({
        id: normalized.id,
        email: normalized.email,
        displayName: normalized.displayName,
        role: normalized.role,
        quota: this.computeQuotaStatus(normalized),
        createdAt: normalized.createdAt,
        lastLoginAt: normalized.lastLoginAt,
      });
    }
    return out;
  }

  async manageUserQuotaAsOwner(
    targetUserId: string,
    action: 'reset' | 'lock_week' | 'set_limit',
    newLimit?: number,
  ): Promise<AdminUserSummary> {
    const target = await this.repo.getUserById(targetUserId);
    if (!target) throw badRequest('المستخدم غير موجود.', 'not_found');
    if (target.role === 'owner') throw forbidden('حساب المالك غير محدود دائماً.', 'cannot_modify_owner');

    const today = new Date().toISOString().slice(0, 10);
    let updated: StoredUser | null = target;
    if (action === 'reset') {
      updated = await this.repo.updateUser(target.id, { quotaUsed: 0, quotaDay: today, quotaLockedUntil: null });
    } else if (action === 'lock_week') {
      const lockedUntil = new Date(Date.now() + WEEK_LOCKOUT_MS).toISOString();
      updated = await this.repo.updateUser(target.id, { quotaUsed: target.quotaLimit, quotaLockedUntil: lockedUntil });
    } else if (action === 'set_limit' && typeof newLimit === 'number' && newLimit >= 1 && newLimit <= 1000) {
      updated = await this.repo.updateUser(target.id, { quotaLimit: Math.round(newLimit) });
    }
    const finalUser = updated ?? target;
    return {
      id: finalUser.id,
      email: finalUser.email,
      displayName: finalUser.displayName,
      role: finalUser.role,
      quota: this.computeQuotaStatus(finalUser),
      createdAt: finalUser.createdAt,
      lastLoginAt: finalUser.lastLoginAt,
    };
  }

  private async issueSession(userId: string): Promise<string> {
    const rawToken = generateSessionToken();
    const tokenHash = await sha256HexToken(rawToken);
    const now = Date.now();
    await this.repo.createSession({
      tokenHash,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    });
    return rawToken;
  }
}
