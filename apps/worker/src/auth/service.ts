import type { AdminUserSummary, AuthUser, QuotaStatus } from '@nova/shared';
import { newId, nowIso, truncate } from '@nova/shared';
import { badRequest, forbidden, HttpError, unauthorized } from '../lib/errors.js';
import type { Store } from '../storage/types.js';
import { generateSessionToken, hashPassword, sha256HexToken, verifyPassword } from './crypto.js';
import type { AuthRepo, StoredUser } from './repo.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const WEEK_LOCKOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 full days (1 week)
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_FAILURES = 8;
const REGISTER_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTER_MAX_PER_IP = 3;

const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;

export interface AuthServiceOptions {
  defaultDailyQuota: number;
  ownerEmail?: string;
  ownerInitialPassword?: string;
  ownerDisplayName?: string;
}

export class AuthService {
  constructor(
    public readonly repo: AuthRepo,
    private opts: AuthServiceOptions,
  ) {}

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

    // 1. If weekly lockout expired, unlock and reset counter.
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
      // Still locked — do NOT reset on midnight until the full 7 days expire.
      return user;
    }

    // 2. Not locked: reset daily counter when a new UTC day starts.
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

  /**
   * Verify and deduct user quota BEFORE invoking any AI model or GPU studio engine.
   * Owner accounts (`role === 'owner'`) bypass all limits completely.
   */
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

  async register(input: { email: string; password: string; displayName: string; clientIp: string }): Promise<{ user: AuthUser; token: string }> {
    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';
    const rawName = (input.displayName ?? '').replace(/[\u0000-\u001F<>]/g, '').trim();

    if (!EMAIL_RE.test(email) || email.length > 160) {
      throw badRequest('يرجى إدخال بريد إلكتروني صحيح.', 'invalid_email');
    }
    if (password.length < 8 || password.length > 128) {
      throw badRequest('كلمة المرور يجب أن تكون 8 أحرف على الأقل لحماية حسابك.', 'weak_password');
    }
    if (rawName.length < 2) {
      throw badRequest('يرجى كتابة اسم العرض (حرفين على الأقل).', 'invalid_name');
    }

    const ipHash = await sha256HexToken(`reg_ip:${input.clientIp || 'unknown'}`);
    const allowedIp = await this.repo.consumeRateLimit(`reg:${ipHash}`, REGISTER_MAX_PER_IP, REGISTER_WINDOW_MS);
    if (!allowedIp) {
      throw new HttpError(429, 'تم الوصول للحد الأقصى من إنشاء الحسابات من هذه الشبكة اليوم. حاول لاحقاً.', 'register_rate_limited');
    }

    const existing = await this.repo.getUserByEmail(email);
    if (existing) {
      throw badRequest('هذا البريد الإلكتروني مسجّل مسبقاً. يرجى تسجيل الدخول.', 'email_taken');
    }

    // Reserve owner email exclusively for the platform owner if configured
    if (this.opts.ownerEmail && email === this.opts.ownerEmail.trim().toLowerCase()) {
      throw forbidden('هذا البريد مخصص لمالك المنصة فقط. يرجى تسجيل الدخول.', 'owner_email_reserved');
    }

    const { hashHex, saltHex } = await hashPassword(password);
    const now = nowIso();
    const stored: StoredUser = {
      id: newId('usr'),
      email,
      displayName: truncate(rawName, 60),
      passwordHash: hashHex,
      passwordSalt: saltHex,
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
    // Perform dummy PBKDF2 even when user doesn't exist to prevent email-enumeration timing attacks!
    if (!existing) {
      await hashPassword(password, '00112233445566778899aabbccddeeff');
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
    // Revoke all other active sessions on password change
    await this.repo.deleteUserSessions(userId, keepTokenHash);
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
