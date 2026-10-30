import type { AppDeps } from './context.js';
import { bootstrap } from './bootstrap.js';
import type { RawEnv } from './env.js';

/**
 * Cloudflare Workers entry point.
 *
 * The dependency graph is built lazily on the first request and cached on the
 * global, so warm isolates do not re-read config or re-init the store.
 */
interface NovaGlobal {
  __nova?: Promise<{ app: { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }; deps: AppDeps }>;
}

export default {
  async fetch(request: Request, env: RawEnv, ctx: ExecutionContext): Promise<Response> {
    const g = globalThis as unknown as NovaGlobal;
    // Config can change between deployments; key the cache on a cheap marker so
    // a stale isolate never serves an old provider setup.
    const cacheKey = `${env.NOVA_VERSION ?? '0'}:${env.NOVA_PROVIDER_PRIORITY ?? ''}:${env.NOVA_SANDBOX ?? ''}`;
    if (!g.__nova || (g as unknown as { __novaKey?: string }).__novaKey !== cacheKey) {
      g.__nova = bootstrap({ env }).then(({ app, deps }) => ({ app: app as never, deps }));
      (g as unknown as { __novaKey?: string }).__novaKey = cacheKey;
    }
    const { app, deps } = await g.__nova;
    const url = new URL(request.url);

    // Everything under /api is handled by the Hono app; the rest is the web app.
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    if (env.ASSETS) {
      return (env.ASSETS as { fetch(req: Request): Promise<Response> }).fetch(request);
    }
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({
          service: 'NOVA AI Cloud API',
          version: deps.cfg.version,
          hint: 'The web app is served from the ASSETS binding. Build it with `npm run build`, or run `npm run dev` for the Vite dev server.',
          health: '/api/health',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<RawEnv>;
