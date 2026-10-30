import { describe, expect, it } from 'vitest';
import { CATALOG, WORKERS_AI_MODELS, OPENROUTER_MODELS, type ModelInfo } from '@nova/shared';
import { ModelRouter } from '../apps/worker/src/ai/router.js';
import { RuntimeSecrets } from '../apps/worker/src/env.js';
import { ProviderNotConfiguredError } from '../apps/worker/src/lib/errors.js';
import { createLogger } from '../apps/worker/src/lib/log.js';
import { JsonStore } from '../apps/worker/src/storage/json-store.js';
import { safeParseArgs } from '../apps/worker/src/ai/providers/openai-compatible.js';
import { CatalogAdapter, testConfig } from './helpers.js';

const log = createLogger('test', 'error');

function makeRouter(adapters: CatalogAdapter[], cfg = testConfig()) {
  const store = new JsonStore();
  return { store, router: new ModelRouter({} as never, cfg, store, new RuntimeSecrets(), log, adapters) };
}

describe('catalog integrity', () => {
  it('every catalog entry declares its verification date and source', () => {
    for (const m of CATALOG) {
      expect(m.verifiedAt, `${m.id} missing verifiedAt`).toBeTruthy();
      expect(m.verifiedSource, `${m.id} missing verifiedSource`).toMatch(/^https:\/\//);
      expect(m.contextWindow).toBeGreaterThan(0);
    }
  });

  it('never labels a paid-only Workers AI model as free', () => {
    const paid = WORKERS_AI_MODELS.filter((m) => m.freeTier === 'paid');
    expect(paid.length).toBeGreaterThan(0);
    for (const m of paid) expect(m.notes).toMatch(/Workers Paid|AI Gateway credits/i);
    // Verified on 2026-10-30 from each model page on developers.cloudflare.com.
    expect(paid.map((m) => m.upstreamId).sort()).toEqual(
      [
        '@cf/deepseek-ai/deepseek-v4-flash-0731',
        '@cf/deepseek-ai/deepseek-v4-pro-0813',
        '@cf/moonshotai/kimi-k2.7-code',
        '@cf/zai-org/glm-5.3',
        '@cf/zai-org/glm-5.3-flash',
      ].sort(),
    );
  });

  it('all OpenRouter catalog entries are ":free" variants or the auto-router', () => {
    for (const m of OPENROUTER_MODELS) {
      const isFreeVariant = m.upstreamId.endsWith(':free');
      const isAutoRouter = m.upstreamId === 'openrouter/free';
      expect(isFreeVariant || isAutoRouter, `${m.upstreamId} is not a free variant`).toBe(true);
    }
  });

  it('gated models are marked so the router can skip them', () => {
    const gated = WORKERS_AI_MODELS.filter((m) => m.access === 'gated');
    expect(gated.map((m) => m.upstreamId).sort()).toEqual(['@cf/swiss-ai/apertus-v1.5-8b', '@cf/utter-project/eurollm-9b-it']);
  });
});

describe('model resolution', () => {
  const codingModel = WORKERS_AI_MODELS.find((m) => m.upstreamId === '@cf/qwen/qwen3.8-27b')!;
  const noToolsModel = WORKERS_AI_MODELS.find((m) => m.upstreamId === '@cf/qwen/qwq-32b')!;
  const gatedModel = WORKERS_AI_MODELS.find((m) => m.access === 'gated')!;
  // Not OPENROUTER_MODELS[0]: that is `thinkingmachines/inkling:free`, which was
  // verified on 2026-10-30 to answer HTTP 403 "only available on agentic
  // harnesses" for plain API keys, so it is catalogued as gated and skipped.
  const openrouterModel = OPENROUTER_MODELS.find((m) => m.access !== 'gated')!;

  it('throws ProviderNotConfiguredError when nothing is callable (never fakes output)', async () => {
    const { router } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [], 'x', false, 'AI binding missing')]);
    await expect(router.resolve({ modelClass: 'chat' })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    try {
      await router.resolve({ modelClass: 'chat' });
    } catch (err) {
      expect((err as ProviderNotConfiguredError).hint).toMatch(/OPENROUTER_API_KEY|NOVA_ENABLE_DIAGNOSTIC/);
    }
  });

  it('honours an explicit model id', async () => {
    const { router } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [codingModel, noToolsModel])]);
    const res = await router.resolve({ modelId: codingModel.id });
    expect(res.model.id).toBe(codingModel.id);
    expect(res.via).toBe('explicit');
  });

  it('refuses a non-tool model for a tool-requiring run and falls back', async () => {
    const { router } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [codingModel, noToolsModel])]);
    const res = await router.resolve({ modelId: noToolsModel.id, requireTools: true });
    expect(res.model.id).toBe(codingModel.id);
    expect(res.via).toBe('fallback');
    expect(res.warnings.join(' ')).toMatch(/function calling/);
  });

  it('catalogues the agentic-harness-only OpenRouter models as gated', () => {
    // Verified live on 2026-10-30 by scripts/probe-openrouter-free.mjs:
    // these answer HTTP 403 for a plain API key even though the public
    // /api/v1/models metadata advertises them as free with no restrictions.
    const gated = OPENROUTER_MODELS.filter((m) => m.access === 'gated').map((m) => m.upstreamId);
    expect(gated).toContain('thinkingmachines/inkling:free');
    expect(gated).toContain('thinkingmachines/inkling-small:free');
    for (const m of OPENROUTER_MODELS.filter((x) => x.access === 'gated')) {
      expect(m.notes ?? '').toMatch(/agentic harness/i);
    }
  });

  it('never routes to an agentic-harness-gated model even when it scores best', async () => {
    // inkling:free has the largest context among the free OpenRouter seeds, so
    // without the gate it would win the score and the user would get a 403.
    const cfg = testConfig({ NOVA_PROVIDER_PRIORITY: 'openrouter' });
    const inkling = OPENROUTER_MODELS.find((m) => m.upstreamId === 'thinkingmachines/inkling:free')!;
    const { router } = makeRouter([new CatalogAdapter('openrouter', 'OR', [inkling])], cfg);
    await expect(router.resolve({ modelClass: 'chat' })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('never auto-selects a gated model', async () => {
    const { router } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [gatedModel])]);
    await expect(router.resolve({ modelClass: 'chat' })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('prefers the configured provider priority', async () => {
    const cfg = testConfig({ NOVA_PROVIDER_PRIORITY: 'openrouter,workers-ai' });
    const { router } = makeRouter(
      [new CatalogAdapter('workers-ai', 'WAI', [codingModel]), new CatalogAdapter('openrouter', 'OR', [openrouterModel])],
      cfg,
    );
    const res = await router.resolve({ modelClass: 'chat' });
    expect(res.model.provider).toBe('openrouter');
  });

  it('prefers free-tier models over paid ones in the same class', async () => {
    const paid = WORKERS_AI_MODELS.find((m) => m.freeTier === 'paid' && m.classes.includes('coding'))!;
    const { router } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [paid, codingModel])]);
    const res = await router.resolve({ modelClass: 'coding' });
    expect(res.model.id).toBe(codingModel.id);
  });

  it('uses the env override for a class when it is callable', async () => {
    const cfg = testConfig({ NOVA_MODEL_CODING: noToolsModel.id });
    const { router } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [codingModel, noToolsModel])], cfg);
    const res = await router.resolve({ modelClass: 'coding' });
    expect(res.model.id).toBe(noToolsModel.id);
    expect(res.via).toBe('override');
  });

  it('reports provider status truthfully, including simulated adapters', async () => {
    const { router } = makeRouter([
      new CatalogAdapter('workers-ai', 'WAI', [codingModel]),
      new CatalogAdapter('groq', 'Groq', [], 'x', false, 'GROQ_API_KEY is not set'),
    ]);
    const infos = router.providerInfos();
    expect(infos.find((p) => p.id === 'workers-ai')?.status).toBe('ready');
    expect(infos.find((p) => p.id === 'groq')?.status).toBe('missing-key');
    expect(infos.find((p) => p.id === 'groq')?.detail).toMatch(/GROQ_API_KEY/);
    expect(infos.every((p) => p.simulated === true)).toBe(true);
  });

  it('records usage per completion', async () => {
    const { router, store } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [codingModel])]);
    await router.complete({ modelId: codingModel.id, messages: [{ role: 'user', content: 'hi' }], stream: false }, {}, 'chat');
    const usage = await store.usageSummary();
    expect(usage.totals.tokensIn).toBe(1);
    expect(usage.records[0].modelId).toBe(codingModel.id);
  });

  it('exposes every catalog model in the inventory even when unconfigured', async () => {
    const { router } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [], 'x', false)]);
    const inv = await router.inventory();
    const unconfigured: ModelInfo[] = inv.models.filter((m) => !inv.available.includes(m.id));
    expect(unconfigured.length).toBeGreaterThan(10);
    expect(inv.available).toEqual([]);
  });
});

describe('tool-argument parsing (defensive)', () => {
  it('parses strict JSON', () => {
    expect(safeParseArgs('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });
  it('repairs raw newlines inside string literals', () => {
    const broken = '{"path":"a.ts","content":"line1\nline2"}';
    expect(safeParseArgs(broken)).toEqual({ path: 'a.ts', content: 'line1\nline2' });
  });
  it('repairs trailing commas', () => {
    expect(safeParseArgs('{"a":1,}')).toEqual({ a: 1 });
  });
  it('repairs single-quoted arguments when unambiguous', () => {
    expect(safeParseArgs("{'a':'b'}")).toEqual({ a: 'b' });
  });
  it('wraps arrays instead of dropping them', () => {
    expect(safeParseArgs('[1,2]')).toEqual({ items: [1, 2] });
  });
  it('never invents values from unparseable input', () => {
    const out = safeParseArgs('not json at all {');
    expect(out._raw).toBe('not json at all {');
    expect(out._parseError).toBeTruthy();
  });
  it('passes objects through untouched', () => {
    expect(safeParseArgs({ a: 1 })).toEqual({ a: 1 });
  });
});
