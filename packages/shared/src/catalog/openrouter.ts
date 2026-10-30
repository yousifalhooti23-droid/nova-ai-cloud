import type { ModelInfo } from '../types.js';

/**
 * OpenRouter free-variant catalog (`:free` suffix).
 *
 * Verified on 2026-10-30 by querying the PUBLIC endpoint (no API key needed):
 *   GET https://openrouter.ai/api/v1/models
 * filtering for pricing.prompt === 0 && pricing.completion === 0.
 * 19 free variants existed at that moment; the ones below are the text/chat
 * capable entries (audio-only and content-safety classifiers are excluded).
 *
 * Rate limits for `:free` variants (verified from
 * https://openrouter.ai/docs/api-reference/limits.md on 2026-10-30):
 *   - all-time credits < 10  -> 20 requests/minute, 50 requests/day
 *   - all-time credits >= 10 -> 20 requests/minute, 1000 requests/day
 * No card is required to create an account and use free variants.
 *
 * This list drifts. `refreshOpenRouterModels()` re-reads the live catalog and
 * the router merges it with these seeds, so a stale entry never blocks you.
 */
const VERIFIED_AT = '2026-10-30';
const SRC = 'https://openrouter.ai/api/v1/models';
const LIMITS_SRC = 'https://openrouter.ai/docs/api-reference/limits';

export const OPENROUTER_FREE_LIMITS = {
  requestsPerMinute: 20,
  requestsPerDayWithoutCredits: 50,
  requestsPerDayWithCredits: 1000,
  creditThresholdUsd: 10,
  requiresCard: false,
  verifiedAt: VERIFIED_AT,
  source: LIMITS_SRC,
};

/**
 * Upstream ids that OpenRouter refuses for a PLAIN API key with
 * HTTP 403 "only available on agentic harnesses".
 *
 * The public /api/v1/models metadata does NOT expose this restriction
 * (per_request_limits is null and pricing is 0), so the only way to learn it is
 * to actually call the model. Verified live on 2026-10-30 by
 * scripts/probe-openrouter-free.mjs — re-run that script to re-verify.
 *
 * This set is authoritative for BOTH the static seeds below and the live
 * refresh (fromOpenRouterApi), so a cached live entry can never re-open a
 * gate that was verified closed.
 */
export const AGENTIC_HARNESS_GATED: ReadonlySet<string> = new Set([
  'thinkingmachines/inkling:free',
  'thinkingmachines/inkling-small:free',
]);

export const AGENTIC_HARNESS_GATE_NOTE =
  'Returns HTTP 403 "only available on agentic harnesses" for plain API keys. ' +
  'Verified by probing it live on 2026-10-30 (scripts/probe-openrouter-free.mjs); ' +
  'the public model metadata does not advertise this. The router skips it.';

interface Seed {
  upstreamId: string;
  label: string;
  vendor: string;
  classes: ModelInfo['classes'];
  contextWindow: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  /**
   * `gated` = OpenRouter refuses the model for plain API keys. Verified by
   * actually calling it (scripts/probe-openrouter-free.mjs), because the public
   * /api/v1/models metadata does NOT expose this restriction.
   */
  access?: 'open' | 'gated';
  notes?: string;
}

const SEEDS: Seed[] = [
  {
    upstreamId: 'thinkingmachines/inkling:free',
    label: 'Inkling (free)',
    vendor: 'Thinking Machines',
    classes: ['chat', 'reasoning', 'long-context'],
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
  },
  {
    upstreamId: 'thinkingmachines/inkling-small:free',
    label: 'Inkling Small (free)',
    vendor: 'Thinking Machines',
    classes: ['chat', 'long-context'],
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
  },
  {
    upstreamId: 'nvidia/nemotron-3.5-lightning:free',
    label: 'Nemotron 3.5 Lightning (free)',
    vendor: 'NVIDIA',
    classes: ['chat', 'coding', 'long-context'],
    contextWindow: 1000000,
    supportsTools: true,
    notes: 'Fast 1M-context variant — good default for large repos.',
  },
  {
    upstreamId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'Nemotron 3 Ultra 550B (free)',
    vendor: 'NVIDIA',
    classes: ['reasoning', 'coding', 'long-context'],
    contextWindow: 1000000,
    supportsTools: true,
  },
  {
    upstreamId: 'nvidia/nemotron-3.5-super-vl:free',
    label: 'Nemotron 3.5 Super VL (free)',
    vendor: 'NVIDIA',
    classes: ['chat', 'long-context'],
    contextWindow: 1000000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    upstreamId: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    label: 'Nemotron 3 Nano Omni Reasoning (free)',
    vendor: 'NVIDIA',
    classes: ['reasoning'],
    contextWindow: 256000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    upstreamId: 'poolside/laguna-s-2.1:free',
    label: 'Laguna S 2.1 (free)',
    vendor: 'Poolside',
    classes: ['coding', 'chat'],
    contextWindow: 262144,
    supportsTools: true,
    notes: 'Poolside models are code-focused.',
  },
  {
    upstreamId: 'poolside/laguna-xs-2.1:free',
    label: 'Laguna XS 2.1 (free)',
    vendor: 'Poolside',
    classes: ['coding', 'chat'],
    contextWindow: 262144,
    supportsTools: true,
  },
  {
    upstreamId: 'cohere/north-mini-code:free',
    label: 'North Mini Code (free)',
    vendor: 'Cohere',
    classes: ['coding'],
    contextWindow: 256000,
    supportsTools: true,
  },
  {
    upstreamId: 'google/gemma-4-31b-it:free',
    label: 'Gemma 4 31B IT (free)',
    vendor: 'Google',
    classes: ['chat', 'long-context'],
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: true,
  },
  {
    upstreamId: 'google/gemma-4-26b-a4b-it:free',
    label: 'Gemma 4 26B A4B IT (free)',
    vendor: 'Google',
    classes: ['chat', 'long-context'],
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: true,
  },
  {
    upstreamId: 'dots-studio/dots-3-note-preview:free',
    label: 'dots.3 Note Preview (free)',
    vendor: 'dots.studio',
    classes: ['chat'],
    contextWindow: 512000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    upstreamId: 'recursive/flint-v1.0:free',
    label: 'Flint v1.0 (free)',
    vendor: 'Recursive',
    classes: ['chat', 'reasoning'],
    contextWindow: 262144,
    supportsTools: true,
  },
  {
    upstreamId: 'xingchen-agi/xing4.0-29b-a4b:free',
    label: 'Xing 4.0 29B A4B (free)',
    vendor: 'Xingchen AGI',
    classes: ['chat'],
    contextWindow: 262144,
    supportsTools: true,
  },
  {
    upstreamId: 'liquid/lfm-2.5-2.6b:free',
    label: 'LFM 2.5 2.6B (free)',
    vendor: 'Liquid AI',
    classes: ['chat'],
    contextWindow: 65536,
    supportsTools: true,
    notes: 'Small/fast; useful for cheap helper calls (titles, summaries).',
  },
  {
    upstreamId: 'openrouter/free',
    label: 'OpenRouter Free Auto-Router',
    vendor: 'OpenRouter',
    classes: ['chat'],
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    notes: 'OpenRouter picks a free model for you; actual model varies per request.',
  },
];

export const OPENROUTER_MODELS: ModelInfo[] = SEEDS.map((s) => ({
  id: `openrouter:${s.upstreamId}`,
  provider: 'openrouter',
  upstreamId: s.upstreamId,
  label: s.label,
  vendor: s.vendor,
  classes: s.classes,
  contextWindow: s.contextWindow,
  supportsTools: s.supportsTools ?? false,
  supportsStreaming: true,
  supportsVision: s.supportsVision ?? false,
  supportsSystemRole: true,
  pricing: { inputPerMTok: 0, outputPerMTok: 0 },
  freeTier: 'free',
  access: AGENTIC_HARNESS_GATED.has(s.upstreamId) ? 'gated' : (s.access ?? 'open'),
  verifiedAt: VERIFIED_AT,
  verifiedSource: SRC,
  notes: AGENTIC_HARNESS_GATED.has(s.upstreamId) ? (s.notes ?? AGENTIC_HARNESS_GATE_NOTE) : s.notes,
}));

/** Minimal shape of the public OpenRouter /models response. */
export interface OpenRouterApiModel {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[]; modality?: string };
}

/**
 * Convert a live OpenRouter entry into a ModelInfo.
 * Returns null for entries that cannot serve text chat.
 */
export function fromOpenRouterApi(m: OpenRouterApiModel, verifiedAt = new Date().toISOString().slice(0, 10)): ModelInfo | null {
  const inputs = m.architecture?.input_modalities ?? [];
  const outputs = m.architecture?.output_modalities ?? ['text'];
  if (!inputs.includes('text') || !outputs.includes('text')) return null;
  const prompt = Number(m.pricing?.prompt ?? -1);
  const completion = Number(m.pricing?.completion ?? -1);
  const isFree = prompt === 0 && completion === 0;
  const supported = m.supported_parameters ?? [];
  const classes: ModelInfo['classes'] = ['chat'];
  const ctx = m.context_length ?? 8192;
  if (ctx >= 200000) classes.push('long-context');
  if (/code|coding|dev/i.test(m.id) || /poolside|cohere\/north/i.test(m.id)) classes.push('coding');
  if (/reason|think|r1|nemotron-3-nano-omni/i.test(m.id)) classes.push('reasoning');
  return {
    id: `openrouter:${m.id}`,
    provider: 'openrouter',
    upstreamId: m.id,
    label: m.name ?? m.id,
    vendor: m.id.split('/')[0] ?? 'unknown',
    classes,
    contextWindow: ctx,
    supportsTools: supported.includes('tools') || supported.includes('tool_choice'),
    supportsStreaming: true,
    supportsVision: inputs.includes('image'),
    supportsSystemRole: true,
    pricing: { inputPerMTok: prompt * 1e6, outputPerMTok: completion * 1e6 },
    freeTier: isFree ? 'free' : 'paid',
    // A live entry can never re-open a gate we verified closed by probing.
    access: AGENTIC_HARNESS_GATED.has(m.id) ? 'gated' : 'open',
    verifiedAt,
    verifiedSource: SRC,
    notes: AGENTIC_HARNESS_GATED.has(m.id)
      ? AGENTIC_HARNESS_GATE_NOTE
      : isFree
      ? `Free variant. Rate limited to ${OPENROUTER_FREE_LIMITS.requestsPerMinute} req/min and ${OPENROUTER_FREE_LIMITS.requestsPerDayWithoutCredits} req/day below $${OPENROUTER_FREE_LIMITS.creditThresholdUsd} lifetime credits.`
      : undefined,
  };
}
