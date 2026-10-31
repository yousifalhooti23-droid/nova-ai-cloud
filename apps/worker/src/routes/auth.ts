import type {
  AdminUsersResponse,
  AuthChangePasswordRequest,
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthSessionResponse,
} from '@nova/shared';
import type { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';

function resolveClientIp(c: { req: { header(name: string): string | undefined } }): string {
  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;
  return '127.0.0.1';
}

function buildMediaCookie(token: string, isHttps: boolean, maxAgeSec = 30 * 24 * 60 * 60): string {
  const parts = [
    `nova_media=${encodeURIComponent(token)}`,
    'Path=/api/uploads',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookieHeader(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return undefined;
}

export function registerAuthRoutes(app: Hono<AppEnv>) {
  app.get('/api/auth/me', async (c) => {
    const d = c.get('deps');
    const body: AuthSessionResponse = {
      authenticated: Boolean(d.currentUser),
      user: d.currentUser ?? null,
    };
    return c.json(body);
  });

  app.post('/api/auth/register', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => null)) as AuthRegisterRequest | null;
    if (!req) throw badRequest('JSON body is required', 'bad_body');

    const { user, token } = await d.auth.register({
      email: req.email,
      password: req.password,
      displayName: req.displayName,
      clientIp: resolveClientIp(c),
    });

    const isHttps = c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https';
    c.header('set-cookie', buildMediaCookie(token, isHttps));

    const body: AuthSessionResponse = { authenticated: true, user, token };
    return c.json(body, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => null)) as AuthLoginRequest | null;
    if (!req) throw badRequest('JSON body is required', 'bad_body');

    const { user, token } = await d.auth.login({
      email: req.email,
      password: req.password,
      clientIp: resolveClientIp(c),
    });

    const isHttps = c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https';
    c.header('set-cookie', buildMediaCookie(token, isHttps));

    const body: AuthSessionResponse = { authenticated: true, user, token };
    return c.json(body);
  });

  app.post('/api/auth/logout', async (c) => {
    const d = c.get('deps');
    const rawBearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
    const rawCookie = parseCookieHeader(c.req.header('cookie'), 'nova_media');
    await d.auth.logout(rawBearer || rawCookie);

    const isHttps = c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https';
    c.header('set-cookie', buildMediaCookie('', isHttps, 0));
    return c.json({ ok: true });
  });

  app.post('/api/auth/change-password', async (c) => {
    const d = c.get('deps');
    if (!d.currentUser) throw unauthorized('يرجى تسجيل الدخول أولاً.', 'auth_required');
    const req = (await c.req.json().catch(() => null)) as AuthChangePasswordRequest | null;
    if (!req) throw badRequest('JSON body is required', 'bad_body');
    await d.auth.changePassword(
      d.currentUser.id,
      req.currentPassword,
      req.newPassword,
      d.currentTokenHash ?? undefined,
    );
    return c.json({ ok: true });
  });

  /* --------------------------------------------------- Owner Admin Panel */

  app.get('/api/admin/users', async (c) => {
    const d = c.get('deps');
    if (!d.currentUser || d.currentUser.role !== 'owner') {
      throw forbidden('صلاحية مالك المنصة مطلوبة لعرض المستخدمين.', 'owner_only');
    }
    const users = await d.auth.listUsersForOwner();
    const body: AdminUsersResponse = { users };
    return c.json(body);
  });

  app.post('/api/admin/users/:id/quota', async (c) => {
    const d = c.get('deps');
    if (!d.currentUser || d.currentUser.role !== 'owner') {
      throw forbidden('صلاحية مالك المنصة مطلوبة لإدارة الحدود.', 'owner_only');
    }
    const req = (await c.req.json().catch(() => null)) as {
      action?: 'reset' | 'lock_week' | 'set_limit';
      limit?: number;
    } | null;
    if (!req || !req.action || !['reset', 'lock_week', 'set_limit'].includes(req.action)) {
      throw badRequest('action must be reset, lock_week, or set_limit', 'bad_action');
    }
    const user = await d.auth.manageUserQuotaAsOwner(c.req.param('id'), req.action, req.limit);
    return c.json({ user });
  });
}
