import {
  CATALOG, PROVIDER_META, fromOpenRouterApi, type ModelClass, type ModelInfo,
  type ModelsRefreshResponse, type OpenRouterApiModel, type ProviderId, type ProviderInfo,
  estimateTokens, newId, nowIso, truncate,
} from '@nova/shared';
import type { NovaConfig, RawEnv, RuntimeSecrets } from '../env.js';
import { withRuntimeSecrets } from '../env.js';
import { HttpError, ProviderNotConfiguredError } from '../lib/errors.js';
import type { Logger } from '../lib/log.js';
import type { Store } from '../storage/types.js';
import { buildAdapters } from './registry.js';
import type { CompletionRequest, CompletionResult, ProviderAdapter, ResolutionResult, ResolveOptions, StreamHandlers } from './types.js';

/**
 * The Model Router.
 *
 * Responsibilities:
 *  1. Resolve "I need a <class> model" into a concrete (model, adapter) pair.
 *  2. Respect capability requirements (tools/vision/context) — an agent run
 *     never lands on a model without function calling.
 *  3. Fall back across providers, preferring the configured priority order and
 *     free-tier models, and always report *why* it chose something.
 *  4. Refuse to invent output: if nothing real is configured it throws
 *     ProviderNotConfiguredError, which the UI shows verbatim.
 */
export class ModelRouter {
  private adapters: ProviderAdapter[];
  private cfg: NovaConfig;
  private cached: ModelInfo[] = [];
  private catalogPromise: Promise<void> | null = null;

  private overrideAdapters?: ProviderAdapter[];

  constructor(
    private env: RawEnv,
    cfg: NovaConfig,
    private store: Store,
    private secrets: RuntimeSecrets,
    private log: Logger,
    /** Test seam: inject adapters instead of building them from the environment. */
    adapters?: ProviderAdapter[],
  ) {
    this.cfg = cfg;
    this.overrideAdapters = adapters;
    this.adapters = adapters ?? buildAdapters(env, store, []);
  }

  /** Effective config, with any runtime-injected keys merged in. */
  private config(): NovaConfig {
    return withRuntimeSecrets(this.cfg, this.secrets);
  }

  private async ensureCatalog(): Promise<void> {
    if (this.catalogPromise) return this.catalogPromise;
    this.catalogPromise = (async () => {
      try {
        this.cached = await this.store.cachedModels();
        if (!this.overrideAdapters) this.adapters = buildAdapters(this.env, this.store, this.cached);
      } catch (err) {
        this.log.warn('catalog cache load failed', { error: String(err) });
      }
    })();
    return this.catalogPromise;
  }

  /* ------------------------------------------------------------ inventory */

  providerInfos(): ProviderInfo[] {
    const cfg = this.config();
    return this.adapters.map((a) => {
      const s = a.status(cfg);
      return {
        id: a.id,
        label: a.label,
        status: s.status,
        detail: s.detail,
        modelCount: a.availableModels(cfg).length,
        simulated: s.simulated,
        docsUrl: PROVIDER_META[a.id]?.docsUrl,
      };
    });
  }

  /** Every model the router knows about, plus the ids that are actually callable. */
  async inventory(): Promise<{ models: ModelInfo[]; available: string[] }> {
    await this.ensureCatalog();
    const cfg = this.config();
    const available = new Set<string>();
    for (const a of this.adapters) for (const m of a.availableModels(cfg)) available.add(m.id);

    const byId = new Map<string, ModelInfo>();
    for (const m of [...this.cached, ...this.adapters.flatMap((a) => a.availableModels(cfg))]) byId.set(m.id, m);
    // Static catalog entries stay visible even when their provider is not configured,
    // so the UI can explain *why* an option is unavailable instead of hiding it.
    for (const m of CATALOG) if (!byId.has(m.id)) byId.set(m.id, m);

    const models = [...byId.values()].sort((a, b) => {
      const av = available.has(a.id) ? 0 : 1;
      const bv = available.has(b.id) ? 0 : 1;
      if (av !== bv) return av - bv;
      const pi = (m: ModelInfo) => Math.max(0, cfg.providerPriority.indexOf(m.provider));
      if (pi(a) !== pi(b)) return pi(a) - pi(b);
      return a.label.localeCompare(b.label);
    });
    return { models, available: [...available] };
  }

  /* ----------------------------------------------------------- resolution */

  async resolve(opts: ResolveOptions): Promise<ResolutionResult> {
    await this.ensureCatalog();
    const cfg = this.config();
    const cls: ModelClass = opts.modelClass ?? 'chat';
    const warnings: string[] = [];

    const isCallable = (m: ModelInfo): boolean => {
      const adapter = this.adapters.find((a) => a.id === m.provider);
      if (!adapter) return false;
      if (adapter.status(cfg).status !== 'ready') return false;
      return adapter.availableModels(cfg).some((x) => x.id === m.id);
    };

    const usable = (m: ModelInfo): boolean => {
      if (opts.requireTools && !m.supportsTools) return false;
      if (opts.requireVision && !m.supportsVision) return false;
      if (opts.minContext && m.contextWindow < opts.minContext) return false;
      if (m.access === 'gated') return false; // needs an access request; never silently picked
      return isCallable(m);
    };

    // 1. Explicit user choice.
    if (opts.modelId) {
      const { models } = await this.inventory();
      const wanted = models.find((m) => m.id === opts.modelId);
      if (!wanted) {
        throw new HttpError(400, `Unknown model "${opts.modelId}".`, 'unknown_model', 'Call GET /api/models for the current list.');
      }
      if (usable(wanted)) {
        return { model: wanted, adapter: this.adapterFor(wanted), via: 'explicit', warnings };
      }
      const st = this.adapterFor(wanted)?.status(cfg);
      const reason =
        st && st.status !== 'ready'
          ? st.detail
          : !wanted.supportsTools && opts.requireTools
            ? `"${wanted.label}" does not support function calling, which the agent requires.`
            : wanted.access === 'gated'
              ? `"${wanted.label}" requires an access request with the provider (marked as gated).`
              : `"${wanted.label}" is not callable in this runtime.`;
      warnings.push(`Requested model unavailable: ${reason}`);

      // 1b. Same upstream model on a different provider.
      const twin = [...this.adapters]
        .sort((a, b) => this.priority(a.id, cfg) - this.priority(b.id, cfg))
        .flatMap((a) => a.availableModels(cfg))
        .find((m) => m.upstreamId === wanted.upstreamId && usable(m));
      if (twin) {
        warnings.push(`Falling back to the same model on ${twin.provider}.`);
        return { model: twin, adapter: this.adapterFor(twin), via: 'fallback', warnings };
      }
    }

    // 2. Configured override for the class.
    const override = cfg.classOverrides[cls];
    if (override) {
      const { models } = await this.inventory();
      const m = models.find((x) => x.id === override);
      if (m && usable(m)) return { model: m, adapter: this.adapterFor(m), via: 'override', warnings };
      if (m) warnings.push(`Configured ${cls} model "${m.label}" is unavailable; picking a substitute.`);
    }

    // 3. Class default: score the callable candidates.
    const { models } = await this.inventory();
    const candidates = models
      .filter((m) => m.classes.includes(cls) && usable(m))
      .sort((a, b) => this.score(b, cfg, opts) - this.score(a, cfg, opts));

    if (candidates.length === 0) {
      const anyCallable = models.filter((m) => usable(m)).sort((a, b) => this.score(b, cfg, opts) - this.score(a, cfg, opts));
      if (anyCallable.length) {
        const m = anyCallable[0];
        warnings.push(`No callable model is tagged "${cls}"; using ${m.label} instead.`);
        return { model: m, adapter: this.adapterFor(m), via: 'fallback', warnings };
      }
      throw new ProviderNotConfiguredError(
        'No AI provider is configured, so NOVA cannot produce a real answer.',
        this.missingProvidersHint(cfg),
      );
    }

    const chosen = candidates[0];
    return { model: chosen, adapter: this.adapterFor(chosen), via: opts.modelId ? 'fallback' : 'class-default', warnings };
  }

  private missingProvidersHint(cfg: NovaConfig): string {
    const lines = this.providerInfos()
      .filter((p) => p.status !== 'ready')
      .map((p) => `• ${p.label}: ${p.detail}`);
    return [
      'Configure one of:',
      ...lines,
      '',
      'Keys go in .dev.vars (wrangler) or .env (node) — never in the frontend.',
      'For a zero-key plumbing test set NOVA_ENABLE_DIAGNOSTIC=true (clearly labelled echo, not an AI).',
    ].join('\n');
  }

  private priority(provider: ProviderId, cfg: NovaConfig): number {
    const i = cfg.providerPriority.indexOf(provider);
    return i === -1 ? 99 : i;
  }

  /** Prefer: configured priority → free tier → tool support → larger context. */
  private score(m: ModelInfo, cfg: NovaConfig, opts: ResolveOptions): number {
    let s = 0;
    s -= this.priority(m.provider, cfg) * 1000;
    if (m.freeTier === 'free') s += 400;
    if (m.freeTier === 'paid') s -= 400;
    if (m.supportsTools) s += 200;
    if (opts.requireTools && !m.supportsTools) s -= 10000;
    s += Math.min(200, Math.log2(Math.max(1024, m.contextWindow)) * 10);
    if (m.access === 'gated') s -= 5000;
    return s;
  }

  private adapterFor(m: ModelInfo): ProviderAdapter {
    const a = this.adapters.find((x) => x.id === m.provider);
    if (!a) throw new HttpError(500, `No adapter registered for provider "${m.provider}".`, 'no_adapter');
    return a;
  }

  /* ----------------------------------------------------------- execution */

  async complete(
    req: Omit<CompletionRequest, 'model'> & { modelId?: string | null; modelClass?: ModelClass },
    handlers: StreamHandlers = {},
    usageKind: 'chat' | 'agent' | 'title' | 'memory' = 'chat',
  ): Promise<CompletionResult & { model: ModelInfo; provider: ProviderId; warnings: string[] }> {
    const resolution = await this.resolve({
      modelId: req.modelId,
      modelClass: req.modelClass,
      requireTools: Boolean(req.tools?.length),
    });
    const request: CompletionRequest = { ...req, model: resolution.model };
    const started = Date.now();
    let result: CompletionResult;
    try {
      result = await resolution.adapter.complete(request, handlers, this.config());
    } catch (err) {
      this.log.warn('provider completion failed', { model: resolution.model.id, error: String(err instanceof Error ? err.message : err) });
      throw err;
    }
    await this.store
      .recordUsage({
        provider: resolution.model.provider,
        modelId: resolution.model.id,
        kind: usageKind,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      })
      .catch(() => undefined);
    this.log.info('completion', {
      model: resolution.model.id,
      ms: Date.now() - started,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      tools: result.toolCalls.length,
    });
    return { ...result, model: resolution.model, provider: resolution.model.provider, warnings: resolution.warnings };
  }

  /* ---------------------------------------------------- live verification */

  /**
   * Re-read a provider's live model list. OpenRouter's endpoint is public; the
   * others need the configured key. Results are cached in D1 and merged with
   * the verified static catalog, so stale entries never block a request.
   */
  async refreshCatalog(provider: ProviderId = 'openrouter'): Promise<ModelsRefreshResponse> {
    const cfg = this.config();
    const fetchedAt = nowIso();
    if (provider === 'workers-ai') {
      throw new HttpError(400, 'Workers AI has no public model-list endpoint.', 'unsupported_refresh', 'Its catalog is verified from developers.cloudflare.com; see packages/shared/src/catalog/workers-ai.ts. Use POST /api/models/probe to test access.');
    }
    const p = cfg.providers[provider];
    if (!p?.baseUrl) {
      throw new HttpError(400, `Provider "${provider}" has no base URL configured.`, 'provider_not_configured', p?.missing, { notConfigured: true });
    }
    const isPublic = provider === 'openrouter';
    if (!isPublic && !p.apiKey) {
      throw new HttpError(400, `Provider "${provider}" needs an API key to list models.`, 'provider_not_configured', p?.missing, { notConfigured: true });
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
    let models: ModelInfo[] = [];
    try {
      const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/models`, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        return { provider, fetchedAt, added: 0, updated: 0, total: 0, models: [], error: `HTTP ${res.status}: ${truncate(await res.text(), 300)}` };
      }
      const json = (await res.json()) as { data?: OpenRouterApiModel[] };
      const today = fetchedAt.slice(0, 10);
      for (const raw of json.data ?? []) {
        const m = fromOpenRouterApi(raw, today);
        if (!m) continue;
        models.push({ ...m, provider, id: `${provider}:${raw.id}`.replace('openrouter:openrouter:', 'openrouter:') });
      }
    } catch (err) {
      return { provider, fetchedAt, added: 0, updated: 0, total: 0, models: [], error: err instanceof Error ? err.message : String(err) };
    }

    const before = new Set((await this.store.cachedModels(provider)).map((m) => m.id));
    await this.store.cacheModels(models);
    this.catalogPromise = null;
    await this.ensureCatalog();
    return {
      provider,
      fetchedAt,
      added: models.filter((m) => !before.has(m.id)).length,
      updated: models.filter((m) => before.has(m.id)).length,
      total: models.length,
      models,
    };
  }

  /** Free, non-inference check of whether the Workers AI binding is usable here. */
  async probeWorkersAi() {
    await this.ensureCatalog();
    const adapter = this.adapters.find((a) => a.id === 'workers-ai') as
      | { probeBinding?: () => Promise<{ mode: string; detail: string; models?: string[] }> }
      | undefined;
    if (!adapter?.probeBinding) return { mode: 'unavailable', detail: 'The Workers AI adapter is not registered.' };
    const out = await adapter.probeBinding();
    // Re-resolve provider info after the probe so the sticky flag is reflected.
    return { ...out, provider: this.providerInfos().find((p) => p.id === 'workers-ai') };
  }

  /**
   * Real 1-token probe. Used by the Settings page to prove a provider works
   * instead of trusting the catalog. Costs a few neurons/tokens — never free.
   */
  async probe(modelId: string): Promise<{ ok: boolean; modelId: string; provider: ProviderId; latencyMs: number; sample: string; error?: string }> {
    const started = Date.now();
    try {
      const res = await this.complete(
        {
          modelId,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          stream: false,
          maxTokens: 8,
          temperature: 0,
        },
        {},
        'chat',
      );
      return { ok: true, modelId: res.model.id, provider: res.provider, latencyMs: Date.now() - started, sample: truncate(res.text || res.reasoning, 200) };
    } catch (err) {
      return { ok: false, modelId, provider: (modelId.split(':')[0] ?? 'custom') as ProviderId, latencyMs: Date.now() - started, sample: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Cheap helper used for conversation titles; never falls back to fake text. */
  async generateTitle(prompt: string): Promise<{ title: string; modelId: string } | null> {
    try {
      const res = await this.complete(
        {
          modelClass: 'chat',
          messages: [
            {
              role: 'system',
              content: 'You name conversations. Reply with a title of at most 6 words, in the same language as the user message. No quotes, no punctuation at the end.',
            },
            { role: 'user', content: truncate(prompt, 1200) },
          ],
          stream: false,
          maxTokens: 24,
          temperature: 0.2,
        },
        {},
        'title',
      );
      const title = res.text.replace(/^["'`]|["'`]$/g, '').trim().slice(0, 80);
      if (!title) return null;
      return { title, modelId: res.model.id };
    } catch (err) {
      this.log.warn('title generation skipped', { error: String(err) });
      return null;
    }
  }

  estimate(messages: { content: string }[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0);
  }

  newRequestId(): string {
    return newId('req');
  }
}
