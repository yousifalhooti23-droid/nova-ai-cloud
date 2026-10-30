import type { ModelsRefreshResponse, ModelsResponse, ProviderId } from '@nova/shared';
import { MODEL_CLASSES, PROVIDER_META, WORKERS_AI_VERIFIED_AT } from '@nova/shared';
import { badRequest } from '../lib/errors.js';
import type { AppEnv } from '../context.js';
import type { Hono } from 'hono';

export function registerModelRoutes(app: Hono<AppEnv>) {
  /** Catalog + provider status. This is what powers the model picker. */
  app.get('/api/models', async (c) => {
    const d = c.get('deps');
    const [{ models, available }, settings] = await Promise.all([d.router.inventory(), d.store.getSettings()]);
    const notes: string[] = [
      `Workers AI catalog verified ${WORKERS_AI_VERIFIED_AT} against developers.cloudflare.com (free = no "Workers Paid required" notice on the model page).`,
      PROVIDER_META['workers-ai'].freeTierSummary,
      PROVIDER_META.openrouter.freeTierSummary,
      PROVIDER_META.groq.freeTierSummary,
      'Models whose provider is not configured are listed with a reason instead of being hidden.',
      'Paid-only models are never presented as free, and no paid provider is enabled without you setting a key.',
    ];
    const body: ModelsResponse & { availableModelIds: string[] } = {
      models,
      providers: d.router.providerInfos(),
      defaults: { ...Object.fromEntries(MODEL_CLASSES.map((k) => [k, null])), ...settings.defaults } as ModelsResponse['defaults'],
      catalogVerifiedAt: WORKERS_AI_VERIFIED_AT,
      notes,
      availableModelIds: available,
    };
    return c.json(body);
  });

  /** Re-read a provider's live model list (public for OpenRouter, key for others). */
  app.post('/api/models/refresh', async (c) => {
    const d = c.get('deps');
    const provider = (await c.req.json().catch(() => ({}))) as { provider?: string };
    const id = (provider.provider ?? 'openrouter') as ProviderId;
    if (!['openrouter', 'groq', 'custom'].includes(id)) throw badRequest(`Live refresh is not supported for "${id}".`, 'unsupported_provider');
    const out: ModelsRefreshResponse = await d.router.refreshCatalog(id);
    return c.json(out);
  });

  /**
   * Free Workers AI binding probe (catalog read, no inference, no neurons spent).
   * Tells you whether the binding is reachable from this runtime — under
   * `wrangler dev --local` it reports mode:"local" with the exact fix.
   */
  app.get('/api/models/workers-ai-probe', async (c) => {
    const d = c.get('deps');
    return c.json(await d.router.probeWorkersAi());
  });

  /** Real 1-token probe: proves a provider works instead of trusting the catalog. */
  app.post('/api/models/probe', async (c) => {
    const d = c.get('deps');
    const body = (await c.req.json().catch(() => ({}))) as { modelId?: string };
    if (!body.modelId || typeof body.modelId !== 'string') throw badRequest('modelId is required', 'bad_request');
    if (body.modelId.length > 200) throw badRequest('modelId is too long', 'bad_request');
    return c.json(await d.router.probe(body.modelId));
  });
}
