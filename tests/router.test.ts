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

  it('excludes all paid-only and gated models from the catalog', () => {
    expect(CATALOG.every((m) => m.freeTier === 'free')).toBe(true);
    expect(CATALOG.every((m) => m.access === 'open')).toBe(true);
    expect(WORKERS_AI_MODELS.some((m) => m.freeTier === 'paid')).toBe(false);
    expect(WORKERS_AI_MODELS.some((m) => m.access === 'gated')).toBe(false);
    expect(OPENROUTER_MODELS.some((m) => m.access === 'gated')).toBe(false);
  });

  it('all OpenRouter catalog entries are ":free" variants or the auto-router', () => {
    for (const m of OPENROUTER_MODELS) {
      const isFreeVariant = m.upstreamId.endsWith(':free');
      const isAutoRouter = m.upstreamId === 'openrouter/free';
      expect(isFreeVariant || isAutoRouter, `${m.upstreamId} is not a free variant`).toBe(true);
    }
  });
});

describe('model resolution', () => {
  const codingModel = WORKERS_AI_MODELS.find((m) => m.upstreamId === '@cf/qwen/qwen3.8-27b')!;
  const noToolsModel = WORKERS_AI_MODELS.find((m) => m.upstreamId === '@cf/qwen/qwq-32b')!;
  const gatedModel: ModelInfo = {
    ...codingModel,
    id: 'workers-ai:gated-test',
    upstreamId: '@cf/test/gated',
    label: 'Gated Test',
    access: 'gated',
  };
  const paidModel: ModelInfo = {
    ...codingModel,
    id: 'workers-ai:paid-test',
    upstreamId: '@cf/test/paid',
    label: 'Paid Test',
    freeTier: 'paid',
  };
  const openrouterModel = OPENROUTER_MODELS[0]!;

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

  it('filters out paid and gated entries during live OpenRouter catalog import', async () => {
    const { fromOpenRouterApi } = await import('@nova/shared');
    expect(
      fromOpenRouterApi({
        id: 'openai/gpt-5',
        pricing: { prompt: '0.00001', completion: '0.00003' },
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      }),
    ).toBeNull();
    expect(
      fromOpenRouterApi({
        id: 'thinkingmachines/inkling:free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      }),
    ).toBeNull();
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

  it('excludes paid models from inventory and selects free models', async () => {
    const { router } = makeRouter([new CatalogAdapter('workers-ai', 'WAI', [paidModel, codingModel])]);
    const inv = await router.inventory();
    expect(inv.models.some((m) => m.id === paidModel.id)).toBe(false);
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
