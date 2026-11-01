import { Hono } from 'hono';
import { newId } from '@nova/shared';
import { GitService } from './agent/git.js';
import { constantTimeEqual } from './auth/crypto.js';
import type { AppDeps, AppEnv } from './context.js';
import { describeError, HttpError } from './lib/errors.js';
import { globalIpRateLimiter } from './lib/rate-limit.js';
import { registerAgentRoutes } from './routes/agent.js';
import { parseCookieHeader, registerAuthRoutes } from './routes/auth.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMiscRoutes } from './routes/misc.js';
import { registerModelRoutes } from './routes/models.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSandboxRoutes } from './routes/sandbox.js';
import { registerStudioRoutes } from './routes/studio.js';
import { ScopedStore } from './storage/scoped-store.js';

const PUBLIC_AUTH_PATHS = new Set([
  '/api/health',
  '/api/auth/config',
  '/api/auth/me',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-otp',
  '/api/auth/resend-otp',
  '/api/auth/google',
  '/api/auth/logout',
]);

function isAllowedOrigin(origin: string | undefined, configuredAllowed: string[], userAuthEnabled: boolean): boolean {
  if (!origin) return true;
  if (configuredAllowed.includes('*') && !userAuthEnabled) return true;
  if (configuredAllowed.includes(origin)) return true;
  // Localhost / Loopback dev servers on any port (Vite, Hono, Node dev server)
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?$/i.test(origin)) return true;
  // Tauri desktop app, Capacitor, or custom webview schemes
  if (/^(?:tauri|capacitor):\/\//i.test(origin) || /^https?:\/\/(?:tauri|capacitor)\.localhost(?::\d+)?$/i.test(origin)) return true;
  // Cloudflare Workers and Cloudflare Pages official domains
  if (/^https:\/\/([a-zA-Z0-9-]+\.)*(?:workers\.dev|pages\.dev)$/i.test(origin)) return true;
  return false;
}

/**
 * Build the HTTP app. The same Hono instance is exported by the Workers entry
 * (src/index.ts) and mounted by the Node dev runtime (src/node.ts).
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('requestId', newId('req'));
    c.set('startedAt', Date.now());

    // CORS: strict yet flexible allow-list protecting against unauthorized cross-origin requests
    const origin = c.req.header('origin');
    const originAllowed = isAllowedOrigin(origin, deps.cfg.allowedOrigins, deps.cfg.userAuthEnabled);

    if (origin && originAllowed) {
      c.res.headers.set('access-control-allow-origin', origin);
      c.res.headers.set('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      c.res.headers.set(
        'access-control-allow-headers',
        'content-type,authorization,x-nova-admin,x-nova-token,x-session-id,x-client-session-id',
      );
      c.res.headers.set('access-control-max-age', '86400');
      c.res.headers.set('vary', 'Origin');
    }

    if (c.req.method === 'OPTIONS') {
      const headers = new Headers();
      if (origin && originAllowed) {
        headers.set('access-control-allow-origin', origin);
        headers.set('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
        headers.set('access-control-allow-headers', 'content-type,authorization,x-nova-admin,x-nova-token,x-session-id,x-client-session-id');
        headers.set('access-control-max-age', '86400');
        headers.set('vary', 'Origin');
      }
      return new Response(null, { status: 204, headers });
    }

    const isApi = c.req.path.startsWith('/api/');
    const isUploadRead = (c.req.method === 'GET' || c.req.method === 'HEAD') && c.req.path.startsWith('/api/uploads/');

    // Anti-Abuse IP Rate Limiter (protects free cloud quotas; exempts loopback and health checks)
    const clientIp =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-real-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      '127.0.0.1';

    const isLoopback = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost';

    if (isApi && !isLoopback && c.req.path !== '/api/health') {
      const rl = globalIpRateLimiter.isLimited(clientIp);
      c.res.headers.set('X-RateLimit-Limit', '25');
      c.res.headers.set('X-RateLimit-Remaining', String(rl.remaining));
      c.res.headers.set('X-RateLimit-Reset', String(rl.resetInSec));

      if (rl.limited) {
        c.res.headers.set('Retry-After', String(rl.resetInSec));
        return c.json(
          {
            error: 'تم تجاوز الحد الأقصى المسموح به للطلبات بالدقيقة. يرجى الانتظار لحماية الحصص السحابية المجانية.',
            code: 'rate_limited',
            hint: `Too many requests from this IP. Please wait ${rl.resetInSec} seconds.`,
          },
          429,
        );
      }
    }

    // Optional shared access token guard (constant-time comparison).
    if (deps.cfg.accessToken && isApi && c.req.path !== '/api/health') {
      const provided =
        c.req.header('x-nova-token') ??
        (!deps.cfg.userAuthEnabled ? c.req.header('authorization')?.replace(/^Bearer\s+/i, '') : undefined) ??
        (isUploadRead ? c.req.query('access_token') ?? c.req.query('token') : undefined) ??
        '';
      if (!provided || !constantTimeEqual(provided, deps.cfg.accessToken)) {
        return c.json(
          {
            error: 'Access token required.',
            code: 'auth_required',
            hint: 'Provide NOVA_ACCESS_TOKEN via the x-nova-token header or Settings.',
          },
          401,
        );
      }
    }

    // Per-user session authentication & strict multi-tenant Store isolation.
    if (isApi) {
      const bearerToken = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
      const isSafeMethod = c.req.method === 'GET' || c.req.method === 'HEAD';
      const reqOrigin = c.req.header('origin');
      const reqHost = c.req.header('host');
      let sameOriginWrite = false;
      if (reqOrigin && reqHost) {
        try {
          sameOriginWrite = new URL(reqOrigin).host.toLowerCase() === reqHost.toLowerCase();
        } catch {
          sameOriginWrite = false;
        }
      }
      // First-party HttpOnly SameSite=Strict cookie fallback for mobile browsers
      // (Brave Shields / iOS Private Browsing) where localStorage is blocked.
      const cookieToken =
        isSafeMethod || sameOriginWrite
          ? parseCookieHeader(c.req.header('cookie'), 'nova_media')
          : undefined;
      const queryMediaToken = isUploadRead ? c.req.query('token') : undefined;
      const candidateToken = bearerToken || cookieToken || queryMediaToken;
      const authHit = candidateToken ? await deps.auth.authenticateToken(candidateToken) : null;
      const rawSessionId = c.req.header('x-session-id') || c.req.header('x-client-session-id');
      const cleanSessionId = rawSessionId ? rawSessionId.trim().slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '') : undefined;

      if (authHit) {
        const scopedStore = new ScopedStore(deps.store, deps.auth.repo, authHit.user.id);
        c.set('deps', {
          ...deps,
          store: scopedStore,
          router: deps.router.withStore(scopedStore),
          git: new GitService(scopedStore),
          currentUser: authHit.user,
          currentTokenHash: authHit.tokenHash,
        });
      } else if (deps.cfg.userAuthEnabled && !PUBLIC_AUTH_PATHS.has(c.req.path)) {
        return c.json(
          {
            error: 'يرجى تسجيل الدخول للوصول إلى حسابك الخاص.',
            code: 'auth_required',
          },
          401,
        );
      } else if (cleanSessionId) {
        // Strict tenant isolation for anonymous / local sessions via client-generated cryptographic session ID
        const sessionUserId = `sess_${cleanSessionId}`;
        const scopedStore = new ScopedStore(deps.store, deps.auth.repo, sessionUserId);
        c.set('deps', {
          ...deps,
          store: scopedStore,
          router: deps.router.withStore(scopedStore),
          git: new GitService(scopedStore),
          currentUser: undefined,
          currentTokenHash: undefined,
        });
      }
    }

    await next();

    // Fortress HTTP security headers on every response.
    c.res.headers.set('x-content-type-options', 'nosniff');
    c.res.headers.set('x-frame-options', 'DENY');
    c.res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    c.res.headers.set('permissions-policy', 'camera=(), microphone=(self), geolocation=(), payment=()');
    if (c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https') {
      c.res.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    if (isApi && !isUploadRead) {
      const contentType = c.res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        c.res.headers.set('cache-control', 'no-cache, no-transform');
        c.res.headers.set('x-accel-buffering', 'no');
      } else {
        c.res.headers.set('cache-control', 'no-store, private');
      }
    }
  });

  app.onError((err, c) => {
    const { message, code } = describeError(err);
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) c.get('deps').log.error('request failed', { path: c.req.path, error: message, code });
    const body = err instanceof HttpError ? err.toJSON() : { error: message, code };
    const resp = c.json(body, status as 400);
    resp.headers.set('x-content-type-options', 'nosniff');
    resp.headers.set('cache-control', 'no-store, private');
    return resp;
  });

  app.notFound((c) =>
    c.json({ error: `No route for ${c.req.method} ${c.req.path}`, code: 'not_found', hint: 'API routes live under /api/*' }, 404),
  );

  registerHealthRoutes(app, deps);
  registerAuthRoutes(app);
  registerModelRoutes(app);
  registerChatRoutes(app);
  registerConversationRoutes(app);
  registerProjectRoutes(app);
  registerAgentRoutes(app);
  registerSandboxRoutes(app);
  registerStudioRoutes(app);
  registerMiscRoutes(app);

  return app;
}
