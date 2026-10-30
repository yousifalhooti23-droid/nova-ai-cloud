import type { ModelClass, ModelInfo, ProviderId } from '../types.js';
import { OPENROUTER_MODELS, OPENROUTER_FREE_LIMITS } from './openrouter.js';
import { WORKERS_AI_MODELS, WORKERS_AI_FREE_PLAN_NOTE, WORKERS_AI_VERIFIED_AT } from './workers-ai.js';

/**
 * The static (verified) catalog. Providers that are not configured still show
 * up here — greyed out with a reason — so the UI never silently hides options.
 */
export const CATALOG: ModelInfo[] = [...WORKERS_AI_MODELS, ...OPENROUTER_MODELS];

export { OPENROUTER_MODELS, OPENROUTER_FREE_LIMITS, WORKERS_AI_MODELS, WORKERS_AI_FREE_PLAN_NOTE, WORKERS_AI_VERIFIED_AT };
export { fromOpenRouterApi, type OpenRouterApiModel } from './openrouter.js';
export { AGENTIC_HARNESS_GATED, AGENTIC_HARNESS_GATE_NOTE } from './openrouter.js';
export { WORKERS_AI_EMBEDDING_MODELS } from './workers-ai.js';

/**
 * Provider metadata: free-tier facts, what's required, where to get a key.
 * `requiresCard: null` means "not verified" — we never guess.
 */
export const PROVIDER_META: Record<
  ProviderId,
  {
    label: string;
    docsUrl: string;
    keyEnvVar: string | null;
    freeTierSummary: string;
    requiresCard: boolean | null;
    verifiedAt: string;
  }
> = {
  'workers-ai': {
    label: 'Cloudflare Workers AI',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/',
    keyEnvVar: null,
    freeTierSummary: WORKERS_AI_FREE_PLAN_NOTE,
    requiresCard: false,
    verifiedAt: WORKERS_AI_VERIFIED_AT,
  },
  openrouter: {
    label: 'OpenRouter',
    docsUrl: 'https://openrouter.ai/settings/keys',
    keyEnvVar: 'OPENROUTER_API_KEY',
    freeTierSummary: `${OPENROUTER_FREE_LIMITS.requestsPerMinute} req/min, ${OPENROUTER_FREE_LIMITS.requestsPerDayWithoutCredits} req/day for ":free" models (1000/day once you have >= $10 lifetime credits). No card required.`,
    requiresCard: false,
    verifiedAt: '2026-10-30',
  },
  groq: {
    label: 'Groq',
    docsUrl: 'https://console.groq.com/docs/models',
    keyEnvVar: 'GROQ_API_KEY',
    freeTierSummary:
      'NOT verified as free. On 2026-10-30 the Groq model page lists per-token prices for most chat models and marks Llama 3.1/3.3 as "Enterprise — Contact Sales". Configure only if your account has access.',
    requiresCard: null,
    verifiedAt: '2026-10-30',
  },
  custom: {
    label: 'Custom OpenAI-compatible',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    keyEnvVar: 'NOVA_CUSTOM_API_KEY',
    freeTierSummary:
      'Any endpoint speaking the OpenAI chat-completions API (Ollama, LM Studio, vLLM, Together, OpenAI, ...). Cost depends entirely on that endpoint.',
    requiresCard: null,
    verifiedAt: '2026-10-30',
  },
  diagnostic: {
    label: 'Diagnostic echo (NOT an AI model)',
    docsUrl: 'https://github.com/',
    keyEnvVar: 'NOVA_ENABLE_DIAGNOSTIC',
    freeTierSummary:
      'Opt-in plumbing test provider. It echoes your prompt and executes tool calls deterministically so streaming, storage and the agent loop can be verified without any API key. It is not a language model and the UI always labels it as such.',
    requiresCard: false,
    verifiedAt: '2026-10-30',
  },
};

export function findModel(id: string | null | undefined): ModelInfo | undefined {
  if (!id) return undefined;
  return CATALOG.find((m) => m.id === id);
}

export function modelsByClass(cls: ModelClass): ModelInfo[] {
  return CATALOG.filter((m) => m.classes.includes(cls));
}

export function modelsByProvider(provider: ProviderId): ModelInfo[] {
  return CATALOG.filter((m) => m.provider === provider);
}

/** Tool-capable models only — the agent loop cannot run without function calling. */
export function agentCapableModels(): ModelInfo[] {
  return CATALOG.filter((m) => m.supportsTools);
}
