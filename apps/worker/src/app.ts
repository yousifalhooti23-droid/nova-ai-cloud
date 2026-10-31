import { Hono } from 'hono';
import { newId } from '@nova/shared';
import { GitService } from './agent/git.js';
import { constantTimeEqual } from './auth/crypto.js';
import type { AppDeps, AppEnv } from './context.js';
import { describeError, HttpError } from './lib/errors.js';
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

    // CORS: same-origin by default; explicit allow-list otherwise.
    const origin = c.req.header('origin');
    const allowed = deps.cfg.allowedOrigins;
    if (origin && (allowed.includes('*') || allowed.includes(origin))) {
      c.res.headers.set('access-control-allow-origin', origin);
      c.res.headers.set('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      c.res.headers.set('access-control-allow-headers', 'content-type,authorization,x-nova-admin,x-nova-token');
      c.res.headers.set('access-control-max-age', '86400');
      c.res.headers.set('vary', 'Origin');
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204);

    const isApi = c.req.path.startsWith('/api/');
    const isUploadRead = (c.req.method === 'GET' || c.req.method === 'HEAD') && c.req.path.startsWith('/api/uploads/');

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
      const mediaToken = isUploadRead
        ? parseCookieHeader(c.req.header('cookie'), 'nova_media') ?? c.req.query('token')
        : undefined;
      const candidateToken = bearerToken || mediaToken;
      const authHit = candidateToken ? await deps.auth.authenticateToken(candidateToken) : null;

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
      c.res.headers.set('cache-control', 'no-store, private');
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
