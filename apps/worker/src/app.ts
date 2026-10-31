import { Hono } from 'hono';
import { describeError, HttpError } from './lib/errors.js';
import { newId } from '@nova/shared';
import type { AppDeps, AppEnv } from './context.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerModelRoutes } from './routes/models.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSandboxRoutes } from './routes/sandbox.js';
import { registerMiscRoutes } from './routes/misc.js';

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

    // Optional zero-cost access token guard for public Cloudflare deployments.
    if (deps.cfg.accessToken && c.req.path.startsWith('/api/') && c.req.path !== '/api/health') {
      const provided =
        c.req.header('x-nova-token') ??
        c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
      if (provided !== deps.cfg.accessToken) {
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

    await next();
  });

  app.onError((err, c) => {
    const { message, code } = describeError(err);
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) c.get('deps').log.error('request failed', { path: c.req.path, error: message, code });
    const body = err instanceof HttpError ? err.toJSON() : { error: message, code };
    return c.json(body, status as 400);
  });

  app.notFound((c) => c.json({ error: `No route for ${c.req.method} ${c.req.path}`, code: 'not_found', hint: 'API routes live under /api/*' }, 404));

  registerHealthRoutes(app, deps);
  registerModelRoutes(app);
  registerChatRoutes(app);
  registerConversationRoutes(app);
  registerProjectRoutes(app);
  registerAgentRoutes(app);
  registerSandboxRoutes(app);
  registerMiscRoutes(app);

  return app;
}
