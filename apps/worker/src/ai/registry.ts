import { CATALOG, GEMINI_MODELS, GROQ_MODELS, OPENROUTER_MODELS, WORKERS_AI_MODELS, type ModelInfo, type ProviderId } from '@nova/shared';
import type { NovaConfig, RawEnv } from '../env.js';
import type { Store } from '../storage/types.js';
import { DiagnosticAdapter } from './providers/diagnostic.js';
import { OpenAiCompatibleAdapter } from './providers/openai-compatible.js';
import { WorkersAiAdapter } from './providers/workers-ai.js';
import type { ProviderAdapter } from './types.js';

/**
 * Provider registry: the only place that knows which concrete adapters exist.
 * Adding a provider = add an adapter here + a catalog source. Nothing else in
 * the app changes (that is the whole point of the Model Router).
 */
export function buildAdapters(env: RawEnv, store: Store, cached: ModelInfo[]): ProviderAdapter[] {
  const cachedFor = (provider: ProviderId) => cached.filter((m) => m.provider === provider);
  const dedupe = (models: ModelInfo[]) => {
    const byId = new Map<string, ModelInfo>();
    for (const m of models) byId.set(m.id, m);
    return [...byId.values()];
  };

  return [
    new OpenAiCompatibleAdapter(
      'gemini',
      'Google Gemini',
      () => dedupe([...GEMINI_MODELS, ...cachedFor('gemini')]),
      'GEMINI_API_KEY is not set. Get a 100% free key from https://aistudio.google.com/app/apikey (no card required).',
    ),
    new OpenAiCompatibleAdapter(
      'groq',
      'Groq (Ultra-Fast LPU)',
      () => dedupe([...GROQ_MODELS, ...cachedFor('groq')]),
      'GROQ_API_KEY is not set. Get a free key from https://console.groq.com/keys (no card required).',
    ),
    new WorkersAiAdapter(() => (env.AI as never) ?? undefined, env),
    new OpenAiCompatibleAdapter(
      'openrouter',
      'OpenRouter',
      () => dedupe([...OPENROUTER_MODELS, ...cachedFor('openrouter')]),
      'OPENROUTER_API_KEY is not set. Create a key at https://openrouter.ai/settings/keys (no card required for ":free" models).',
    ),
    new OpenAiCompatibleAdapter(
      'custom',
      'Custom OpenAI-compatible endpoint',
      () => cachedFor('custom'),
      'NOVA_CUSTOM_BASE_URL is not set. Point it at any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, Together, OpenAI...).',
    ),
    new DiagnosticAdapter(),
  ];
}

/** Static catalog (verified) — used for model metadata lookups. */
export const STATIC_CATALOG = CATALOG;
export const STATIC_PROVIDERS: Record<string, ModelInfo[]> = {
  gemini: GEMINI_MODELS,
  groq: GROQ_MODELS,
  'workers-ai': WORKERS_AI_MODELS,
  openrouter: OPENROUTER_MODELS,
};
