import type { HealthResponse } from '@nova/shared';
import type { AppDeps, AppEnv } from '../context.js';
import type { Hono } from 'hono';

export function registerHealthRoutes(app: Hono<AppEnv>, deps: AppDeps) {
  app.get('/api/health', async (c) => {
    const sandbox = deps.sandbox.status();
    const body: HealthResponse = {
      ok: true,
      version: deps.cfg.version,
      runtime: deps.cfg.runtime,
      authProtected: Boolean(deps.cfg.accessToken),
      userAuthEnabled: deps.cfg.userAuthEnabled,
      store: {
        kind: deps.store.kind,
        ready: true,
        detail: deps.store.kind === 'd1' ? 'Cloudflare D1' : 'JSON store (Node dev runtime / tests)',
      },
      blob: { kind: deps.blob.kind, ready: true },
      sandbox: { kind: sandbox.kind, ready: sandbox.ready, detail: sandbox.detail },
      providers: deps.router.providerInfos().map((p) => ({
        id: p.id,
        label: p.label,
        status: p.status,
        detail: p.status === 'ready' ? 'Ready' : p.detail,
        modelCount: p.modelCount,
        simulated: p.simulated,
        docsUrl: p.docsUrl,
      })),
      time: new Date().toISOString(),
    };
    return c.json(body);
  });
}
