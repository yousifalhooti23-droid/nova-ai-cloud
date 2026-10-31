import type { UserRole } from '@nova/shared';
import { nowIso } from '@nova/shared';
import type { D1Like } from '../storage/d1-store.js';
import { DEFAULT_SETTINGS, type AppSettings } from '../storage/types.js';

export type OwnedResourceType =
  | 'conversation'
  | 'message'
  | 'project'
  | 'task'
  | 'run'
  | 'memory'
  | 'attachment'
  | 'usage';

export interface StoredUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  quotaLimit: number;
  quotaUsed: number;
  quotaDay: string;
  quotaLockedUntil: string | null;
  createdAt: string;
  lastLoginAt: string;
}

export interface StoredSession {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export interface AuthRepo {
  init(): Promise<void>;
  getUserByEmail(email: string): Promise<StoredUser | null>;
  getUserById(id: string): Promise<StoredUser | null>;
  listUsers(): Promise<StoredUser[]>;
  countUsers(): Promise<number>;
  createUser(user: StoredUser): Promise<void>;
  updateUser(id: string, patch: Partial<Omit<StoredUser, 'id' | 'createdAt'>>): Promise<StoredUser | null>;

  createSession(session: StoredSession): Promise<void>;
  getSession(tokenHash: string): Promise<StoredSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteUserSessions(userId: string, keepTokenHash?: string): Promise<void>;

  assignResource(type: OwnedResourceType, resourceId: string, userId: string): Promise<void>;
  ownsResource(type: OwnedResourceType, resourceId: string, userId: string): Promise<boolean>;
  hasAnyOwner(type: OwnedResourceType, resourceId: string): Promise<boolean>;
  listOwnedIds(type: OwnedResourceType, userId: string): Promise<Set<string>>;
  deleteResource(type: OwnedResourceType, resourceId: string): Promise<void>;

  getUserSettings(userId: string): Promise<AppSettings>;
  saveUserSettings(userId: string, patch: Partial<AppSettings>): Promise<AppSettings>;

  /** Returns true if allowed (under limit), false if rate-limited. */
  consumeRateLimit(bucketKey: string, maxHits: number, windowMs: number): Promise<boolean>;
  resetRateLimit(bucketKey: string): Promise<void>;
}

/* ----------------------------------------------------------- D1 Auth Repo */

export class D1AuthRepo implements AuthRepo {
  constructor(private db: D1Like) {}

  async init(): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `CREATE TABLE IF NOT EXISTS auth_users (
           id                 TEXT PRIMARY KEY,
           email              TEXT NOT NULL UNIQUE,
           display_name       TEXT NOT NULL,
           password_hash      TEXT NOT NULL,
           password_salt      TEXT NOT NULL,
           role               TEXT NOT NULL DEFAULT 'user',
           quota_limit        INTEGER NOT NULL DEFAULT 20,
           quota_used         INTEGER NOT NULL DEFAULT 0,
           quota_day          TEXT NOT NULL DEFAULT '',
           quota_locked_until TEXT,
           created_at         TEXT NOT NULL,
           last_login_at      TEXT NOT NULL
         )`,
      ),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email)'),
      this.db.prepare(
        `CREATE TABLE IF NOT EXISTS auth_sessions (
           token_hash   TEXT PRIMARY KEY,
           user_id      TEXT NOT NULL,
           expires_at   TEXT NOT NULL,
           created_at   TEXT NOT NULL
         )`,
      ),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)'),
      this.db.prepare(
        `CREATE TABLE IF NOT EXISTS resource_owners (
           resource_type TEXT NOT NULL,
           resource_id   TEXT NOT NULL,
           user_id       TEXT NOT NULL,
           created_at    TEXT NOT NULL,
           PRIMARY KEY (resource_type, resource_id)
         )`,
      ),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_resource_owners_user ON resource_owners(user_id, resource_type)'),
      this.db.prepare(
        `CREATE TABLE IF NOT EXISTS user_settings_kv (
           user_id       TEXT PRIMARY KEY,
           settings_json TEXT NOT NULL,
           updated_at    TEXT NOT NULL
         )`,
      ),
      this.db.prepare(
        `CREATE TABLE IF NOT EXISTS auth_rate_limits (
           bucket_key   TEXT PRIMARY KEY,
           hits         INTEGER NOT NULL DEFAULT 0,
           window_start INTEGER NOT NULL
         )`,
      ),
    ]);
  }

  private mapUser(r: Record<string, unknown>): StoredUser {
    return {
      id: String(r.id),
      email: String(r.email),
      displayName: String(r.display_name),
      passwordHash: String(r.password_hash),
      passwordSalt: String(r.password_salt),
      role: String(r.role) === 'owner' ? 'owner' : 'user',
      quotaLimit: Number(r.quota_limit ?? 20),
      quotaUsed: Number(r.quota_used ?? 0),
      quotaDay: String(r.quota_day ?? ''),
      quotaLockedUntil: r.quota_locked_until ? String(r.quota_locked_until) : null,
      createdAt: String(r.created_at),
      lastLoginAt: String(r.last_login_at),
    };
  }

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const r = await this.db
      .prepare('SELECT * FROM auth_users WHERE email = ?')
      .bind(email.trim().toLowerCase())
      .first();
    return r ? this.mapUser(r) : null;
  }

  async getUserById(id: string): Promise<StoredUser | null> {
    const r = await this.db.prepare('SELECT * FROM auth_users WHERE id = ?').bind(id).first();
    return r ? this.mapUser(r) : null;
  }

  async listUsers(): Promise<StoredUser[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM auth_users ORDER BY CASE WHEN role = \'owner\' THEN 0 ELSE 1 END, created_at DESC')
      .all();
    return results.map((r) => this.mapUser(r));
  }

  async countUsers(): Promise<number> {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM auth_users').first<{ n: number }>();
    return Number(r?.n ?? 0);
  }

  async createUser(user: StoredUser): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO auth_users (
           id, email, display_name, password_hash, password_salt, role,
           quota_limit, quota_used, quota_day, quota_locked_until, created_at, last_login_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        user.email.trim().toLowerCase(),
        user.displayName,
        user.passwordHash,
        user.passwordSalt,
        user.role,
        user.quotaLimit,
        user.quotaUsed,
        user.quotaDay,
        user.quotaLockedUntil,
        user.createdAt,
        user.lastLoginAt,
      )
      .run();
  }

  async updateUser(id: string, patch: Partial<Omit<StoredUser, 'id' | 'createdAt'>>): Promise<StoredUser | null> {
    const sets: string[] = [];
    const bind: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col} = ?`);
      bind.push(val);
    };
    if (patch.email !== undefined) push('email', patch.email.trim().toLowerCase());
    if (patch.displayName !== undefined) push('display_name', patch.displayName);
    if (patch.passwordHash !== undefined) push('password_hash', patch.passwordHash);
    if (patch.passwordSalt !== undefined) push('password_salt', patch.passwordSalt);
    if (patch.role !== undefined) push('role', patch.role);
    if (patch.quotaLimit !== undefined) push('quota_limit', patch.quotaLimit);
    if (patch.quotaUsed !== undefined) push('quota_used', patch.quotaUsed);
    if (patch.quotaDay !== undefined) push('quota_day', patch.quotaDay);
    if (patch.quotaLockedUntil !== undefined) push('quota_locked_until', patch.quotaLockedUntil);
    if (patch.lastLoginAt !== undefined) push('last_login_at', patch.lastLoginAt);
    if (sets.length > 0) {
      await this.db.prepare(`UPDATE auth_users SET ${sets.join(', ')} WHERE id = ?`).bind(...bind, id).run();
    }
    return this.getUserById(id);
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(session.tokenHash, session.userId, session.expiresAt, session.createdAt)
      .run();
  }

  async getSession(tokenHash: string): Promise<StoredSession | null> {
    const r = await this.db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).first();
    if (!r) return null;
    const expiresAt = String(r.expires_at);
    if (Date.parse(expiresAt) <= Date.now()) {
      await this.deleteSession(tokenHash);
      return null;
    }
    return {
      tokenHash: String(r.token_hash),
      userId: String(r.user_id),
      expiresAt,
      createdAt: String(r.created_at),
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  async deleteUserSessions(userId: string, keepTokenHash?: string): Promise<void> {
    if (keepTokenHash) {
      await this.db
        .prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?')
        .bind(userId, keepTokenHash)
        .run();
    } else {
      await this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run();
    }
  }

  async assignResource(type: OwnedResourceType, resourceId: string, userId: string): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO resource_owners (resource_type, resource_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(type, resourceId, userId, nowIso())
      .run();
  }

  async ownsResource(type: OwnedResourceType, resourceId: string, userId: string): Promise<boolean> {
    const r = await this.db
      .prepare('SELECT user_id FROM resource_owners WHERE resource_type = ? AND resource_id = ?')
      .bind(type, resourceId)
      .first<{ user_id: string }>();
    return r?.user_id === userId;
  }

  async hasAnyOwner(type: OwnedResourceType, resourceId: string): Promise<boolean> {
    const r = await this.db
      .prepare('SELECT 1 AS ok FROM resource_owners WHERE resource_type = ? AND resource_id = ?')
      .bind(type, resourceId)
      .first<{ ok: number }>();
    return Boolean(r);
  }

  async listOwnedIds(type: OwnedResourceType, userId: string): Promise<Set<string>> {
    const { results } = await this.db
      .prepare('SELECT resource_id FROM resource_owners WHERE user_id = ? AND resource_type = ?')
      .bind(userId, type)
      .all<{ resource_id: string }>();
    return new Set(results.map((r) => String(r.resource_id)));
  }

  async deleteResource(type: OwnedResourceType, resourceId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM resource_owners WHERE resource_type = ? AND resource_id = ?')
      .bind(type, resourceId)
      .run();
  }

  async getUserSettings(userId: string): Promise<AppSettings> {
    const r = await this.db
      .prepare('SELECT settings_json FROM user_settings_kv WHERE user_id = ?')
      .bind(userId)
      .first<{ settings_json: string }>();
    if (!r?.settings_json) {
      return { ...DEFAULT_SETTINGS, defaults: { ...DEFAULT_SETTINGS.defaults }, agent: { ...DEFAULT_SETTINGS.agent } };
    }
    try {
      const parsed = JSON.parse(r.settings_json) as Partial<AppSettings>;
      return {
        locale: parsed.locale === 'en' ? 'en' : 'ar',
        defaults: { ...DEFAULT_SETTINGS.defaults, ...(parsed.defaults ?? {}) },
        agent: { ...DEFAULT_SETTINGS.agent, ...(parsed.agent ?? {}) },
      };
    } catch {
      return { ...DEFAULT_SETTINGS, defaults: { ...DEFAULT_SETTINGS.defaults }, agent: { ...DEFAULT_SETTINGS.agent } };
    }
  }

  async saveUserSettings(userId: string, patch: Partial<AppSettings>): Promise<AppSettings> {
    const cur = await this.getUserSettings(userId);
    const next: AppSettings = {
      locale: patch.locale ?? cur.locale,
      defaults: { ...cur.defaults, ...(patch.defaults ?? {}) },
      agent: patch.agent ? { ...cur.agent, ...patch.agent } : cur.agent,
    };
    await this.db
      .prepare('INSERT OR REPLACE INTO user_settings_kv (user_id, settings_json, updated_at) VALUES (?, ?, ?)')
      .bind(userId, JSON.stringify(next), nowIso())
      .run();
    return next;
  }

  async consumeRateLimit(bucketKey: string, maxHits: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const r = await this.db
      .prepare('SELECT hits, window_start FROM auth_rate_limits WHERE bucket_key = ?')
      .bind(bucketKey)
      .first<{ hits: number; window_start: number }>();
    if (!r || now - Number(r.window_start) >= windowMs) {
      await this.db
        .prepare('INSERT OR REPLACE INTO auth_rate_limits (bucket_key, hits, window_start) VALUES (?, 1, ?)')
        .bind(bucketKey, now)
        .run();
      return true;
    }
    const hits = Number(r.hits) + 1;
    await this.db.prepare('UPDATE auth_rate_limits SET hits = ? WHERE bucket_key = ?').bind(hits, bucketKey).run();
    return hits <= maxHits;
  }

  async resetRateLimit(bucketKey: string): Promise<void> {
    await this.db.prepare('DELETE FROM auth_rate_limits WHERE bucket_key = ?').bind(bucketKey).run();
  }
}

/* ----------------------------------------------------- JSON / Memory Repo */

interface PersistedAuthState {
  users: StoredUser[];
  sessions: StoredSession[];
  owners: { type: OwnedResourceType; resourceId: string; userId: string }[];
  settings: Record<string, AppSettings>;
  rateLimits: Record<string, { hits: number; windowStart: number }>;
}

export class JsonAuthRepo implements AuthRepo {
  private state: PersistedAuthState = {
    users: [],
    sessions: [],
    owners: [],
    settings: {},
    rateLimits: {},
  };
  private fs: typeof import('node:fs') | null = null;
  private path: typeof import('node:path') | null = null;

  constructor(private persistPath?: string) {}

  async init(): Promise<void> {
    if (!this.persistPath) return;
    this.fs = await import('node:fs');
    this.path = await import('node:path');
    if (this.fs.existsSync(this.persistPath)) {
      try {
        const raw = JSON.parse(this.fs.readFileSync(this.persistPath, 'utf8')) as Partial<PersistedAuthState>;
        this.state = {
          users: Array.isArray(raw.users) ? raw.users : [],
          sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
          owners: Array.isArray(raw.owners) ? raw.owners : [],
          settings: raw.settings ?? {},
          rateLimits: raw.rateLimits ?? {},
        };
      } catch {
        /* start clean if corrupt */
      }
    }
  }

  private flush() {
    if (!this.persistPath || !this.fs || !this.path) return;
    try {
      this.fs.mkdirSync(this.path.dirname(this.persistPath), { recursive: true });
      this.fs.writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch {
      /* ignore read-only */
    }
  }

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const clean = email.trim().toLowerCase();
    return this.state.users.find((u) => u.email === clean) ?? null;
  }

  async getUserById(id: string): Promise<StoredUser | null> {
    return this.state.users.find((u) => u.id === id) ?? null;
  }

  async listUsers(): Promise<StoredUser[]> {
    return [...this.state.users].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  async countUsers(): Promise<number> {
    return this.state.users.length;
  }

  async createUser(user: StoredUser): Promise<void> {
    const normalized: StoredUser = { ...user, email: user.email.trim().toLowerCase() };
    this.state.users.push(normalized);
    this.flush();
  }

  async updateUser(id: string, patch: Partial<Omit<StoredUser, 'id' | 'createdAt'>>): Promise<StoredUser | null> {
    const idx = this.state.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    const next: StoredUser = {
      ...this.state.users[idx],
      ...patch,
      email: (patch.email ?? this.state.users[idx].email).trim().toLowerCase(),
    };
    this.state.users[idx] = next;
    this.flush();
    return next;
  }

  async createSession(session: StoredSession): Promise<void> {
    this.state.sessions = this.state.sessions.filter((s) => s.tokenHash !== session.tokenHash);
    this.state.sessions.push(session);
    this.flush();
  }

  async getSession(tokenHash: string): Promise<StoredSession | null> {
    const hit = this.state.sessions.find((s) => s.tokenHash === tokenHash);
    if (!hit) return null;
    if (Date.parse(hit.expiresAt) <= Date.now()) {
      await this.deleteSession(tokenHash);
      return null;
    }
    return hit;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.state.sessions = this.state.sessions.filter((s) => s.tokenHash !== tokenHash);
    this.flush();
  }

  async deleteUserSessions(userId: string, keepTokenHash?: string): Promise<void> {
    this.state.sessions = this.state.sessions.filter((s) => s.userId !== userId || (keepTokenHash && s.tokenHash === keepTokenHash));
    this.flush();
  }

  async assignResource(type: OwnedResourceType, resourceId: string, userId: string): Promise<void> {
    const idx = this.state.owners.findIndex((o) => o.type === type && o.resourceId === resourceId);
    if (idx !== -1) this.state.owners[idx] = { type, resourceId, userId };
    else this.state.owners.push({ type, resourceId, userId });
    this.flush();
  }

  async ownsResource(type: OwnedResourceType, resourceId: string, userId: string): Promise<boolean> {
    return this.state.owners.some((o) => o.type === type && o.resourceId === resourceId && o.userId === userId);
  }

  async hasAnyOwner(type: OwnedResourceType, resourceId: string): Promise<boolean> {
    return this.state.owners.some((o) => o.type === type && o.resourceId === resourceId);
  }

  async listOwnedIds(type: OwnedResourceType, userId: string): Promise<Set<string>> {
    return new Set(this.state.owners.filter((o) => o.type === type && o.userId === userId).map((o) => o.resourceId));
  }

  async deleteResource(type: OwnedResourceType, resourceId: string): Promise<void> {
    this.state.owners = this.state.owners.filter((o) => !(o.type === type && o.resourceId === resourceId));
    this.flush();
  }

  async getUserSettings(userId: string): Promise<AppSettings> {
    const hit = this.state.settings[userId];
    if (!hit) {
      return { ...DEFAULT_SETTINGS, defaults: { ...DEFAULT_SETTINGS.defaults }, agent: { ...DEFAULT_SETTINGS.agent } };
    }
    return {
      locale: hit.locale === 'en' ? 'en' : 'ar',
      defaults: { ...DEFAULT_SETTINGS.defaults, ...(hit.defaults ?? {}) },
      agent: { ...DEFAULT_SETTINGS.agent, ...(hit.agent ?? {}) },
    };
  }

  async saveUserSettings(userId: string, patch: Partial<AppSettings>): Promise<AppSettings> {
    const cur = await this.getUserSettings(userId);
    const next: AppSettings = {
      locale: patch.locale ?? cur.locale,
      defaults: { ...cur.defaults, ...(patch.defaults ?? {}) },
      agent: patch.agent ? { ...cur.agent, ...patch.agent } : cur.agent,
    };
    this.state.settings[userId] = next;
    this.flush();
    return next;
  }

  async consumeRateLimit(bucketKey: string, maxHits: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const cur = this.state.rateLimits[bucketKey];
    if (!cur || now - cur.windowStart >= windowMs) {
      this.state.rateLimits[bucketKey] = { hits: 1, windowStart: now };
      this.flush();
      return true;
    }
    cur.hits += 1;
    this.flush();
    return cur.hits <= maxHits;
  }

  async resetRateLimit(bucketKey: string): Promise<void> {
    delete this.state.rateLimits[bucketKey];
    this.flush();
  }
}
