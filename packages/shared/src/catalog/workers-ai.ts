import type { ModelInfo } from '../types.js';

/**
 * Cloudflare Workers AI catalog.
 *
 * VERIFICATION METHOD (do not "assume" availability):
 *   Every entry below was read from the official model page on
 *   https://developers.cloudflare.com/workers-ai/models/ on 2026-10-30.
 *   `freeTier: 'free'`  -> the page has NO "not available through standard
 *                           Workers Free billing" notice.
 *   `freeTier: 'paid'`  -> the page explicitly requires the Workers Paid plan
 *                           or prepaid AI Gateway credits.
 *   `access: 'gated'`   -> the page asks you to fill an access request form.
 *
 * Free plan quota: 10,000 Neurons per day (shared across all models, resets
 * 00:00 UTC). Unit prices below are the pay-as-you-go rates that apply once the
 * free allocation is used or on the paid plan — they are NOT a claim that the
 * model costs money to try.
 *
 * IMPORTANT: the AI binding always talks to Cloudflare's remote service. Under
 * `wrangler dev --local` calls fail with "Binding AI needs to be run remotely";
 * use `wrangler dev --remote` with credentials, or deploy. The router surfaces
 * that state instead of faking output.
 */
const VERIFIED_AT = '2026-10-30';
const SRC = 'https://developers.cloudflare.com/workers-ai/models/';
const PRICING_SRC = 'https://developers.cloudflare.com/workers-ai/platform/pricing/';

interface Seed {
  id: string;
  upstreamId: string;
  label: string;
  vendor: string;
  classes: ModelInfo['classes'];
  contextWindow: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  pricing: [number, number] | null;
  freeTier: ModelInfo['freeTier'];
  access?: ModelInfo['access'];
  notes?: string;
}

const SEEDS: Seed[] = [
  /* ----------------------------- free allocation ------------------------- */
  {
    id: 'qwen3.8-27b',
    upstreamId: '@cf/qwen/qwen3.8-27b',
    label: 'Qwen 3.8 27B',
    vendor: 'Qwen (Alibaba)',
    classes: ['chat', 'coding', 'long-context'],
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: true,
    pricing: [0.45, 3.2],
    freeTier: 'free',
    notes: 'Default general/coding pick on the Workers free allocation.',
  },
  {
    id: 'glm-4.7-flash',
    upstreamId: '@cf/zai-org/glm-4.7-flash',
    label: 'GLM 4.7 Flash',
    vendor: 'Z.ai',
    classes: ['chat', 'coding'],
    contextWindow: 131072,
    supportsTools: true,
    pricing: [0.0605, 0.4],
    freeTier: 'free',
    notes: 'Cheapest agentic-coding option in the free allocation.',
  },
  {
    id: 'gpt-oss-120b',
    upstreamId: '@cf/openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    vendor: 'OpenAI',
    classes: ['chat', 'reasoning', 'coding'],
    contextWindow: 128000,
    supportsTools: true,
    pricing: [0.35, 0.75],
    freeTier: 'free',
  },
  {
    id: 'gpt-oss-20b',
    upstreamId: '@cf/openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    vendor: 'OpenAI',
    classes: ['chat', 'reasoning'],
    contextWindow: 128000,
    supportsTools: true,
    pricing: [0.2, 0.3],
    freeTier: 'free',
  },
  {
    id: 'nemotron-3-120b-a12b',
    upstreamId: '@cf/nvidia/nemotron-3-120b-a12b',
    label: 'Nemotron 3 120B (A12B)',
    vendor: 'NVIDIA',
    classes: ['chat', 'reasoning', 'long-context'],
    contextWindow: 256000,
    supportsTools: true,
    pricing: [0.5, 1.5],
    freeTier: 'free',
  },
  {
    id: 'llama-3.3-70b-instruct-fp8-fast',
    upstreamId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B Instruct (fast)',
    vendor: 'Meta',
    classes: ['chat', 'coding'],
    contextWindow: 24000,
    supportsTools: true,
    pricing: [0.293, 2.253],
    freeTier: 'free',
  },
  {
    id: 'llama-4-scout-17b-16e-instruct',
    upstreamId: '@cf/meta/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout 17B (16E)',
    vendor: 'Meta',
    classes: ['chat', 'long-context'],
    contextWindow: 131000,
    supportsTools: true,
    pricing: [0.27, 0.85],
    freeTier: 'free',
  },
  {
    id: 'mistral-small-3.1-24b-instruct',
    upstreamId: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    label: 'Mistral Small 3.1 24B',
    vendor: 'Mistral AI',
    classes: ['chat', 'coding'],
    contextWindow: 128000,
    supportsTools: true,
    pricing: [0.351, 0.555],
    freeTier: 'free',
  },
  {
    id: 'granite-4.0-h-micro',
    upstreamId: '@cf/ibm-granite/granite-4.0-h-micro',
    label: 'Granite 4.0 H Micro',
    vendor: 'IBM',
    classes: ['chat'],
    contextWindow: 131000,
    supportsTools: true,
    pricing: [0.017, 0.112],
    freeTier: 'free',
    notes: 'Very low neuron cost — good for high-volume helper calls (titles, memory).',
  },
  {
    id: 'gemma-4-26b-a4b-it',
    upstreamId: '@cf/google/gemma-4-26b-a4b-it',
    label: 'Gemma 4 26B (A4B)',
    vendor: 'Google',
    classes: ['chat', 'long-context'],
    contextWindow: 256000,
    supportsTools: true,
    supportsVision: true,
    pricing: [0.1, 0.3],
    freeTier: 'free',
  },
  {
    id: 'qwen3-30b-a3b-fp8',
    upstreamId: '@cf/qwen/qwen3-30b-a3b-fp8',
    label: 'Qwen3 30B (A3B, fp8)',
    vendor: 'Qwen (Alibaba)',
    classes: ['chat', 'coding'],
    contextWindow: 32768,
    supportsTools: true,
    pricing: [0.0509, 0.335],
    freeTier: 'free',
  },
  {
    id: 'qwen2.5-coder-32b-instruct',
    upstreamId: '@cf/qwen/qwen2.5-coder-32b-instruct',
    label: 'Qwen2.5 Coder 32B',
    vendor: 'Qwen (Alibaba)',
    classes: ['coding'],
    contextWindow: 32768,
    supportsTools: false,
    pricing: [0.66, 1.0],
    freeTier: 'free',
    notes: 'Code completion oriented; the model page does not list function calling, so the router will not use it for the agent loop.',
  },
  {
    id: 'deepseek-r1-distill-qwen-32b',
    upstreamId: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    label: 'DeepSeek R1 Distill Qwen 32B',
    vendor: 'DeepSeek',
    classes: ['reasoning'],
    contextWindow: 80000,
    supportsTools: false,
    pricing: [0.497, 4.881],
    freeTier: 'free',
  },
  {
    id: 'qwq-32b',
    upstreamId: '@cf/qwen/qwq-32b',
    label: 'QwQ 32B',
    vendor: 'Qwen (Alibaba)',
    classes: ['reasoning'],
    contextWindow: 24000,
    supportsTools: false,
    pricing: [0.66, 1.0],
    freeTier: 'free',
  },
  {
    id: 'llama-3.2-11b-vision-instruct',
    upstreamId: '@cf/meta/llama-3.2-11b-vision-instruct',
    label: 'Llama 3.2 Vision 11B',
    vendor: 'Meta',
    classes: ['chat'],
    contextWindow: 128000,
    supportsTools: false,
    supportsVision: true,
    pricing: [0.0485, 0.676],
    freeTier: 'free',
  },
  /* ---------------------- gated (access form required) ------------------- */
  {
    id: 'apertus-v1.5-8b',
    upstreamId: '@cf/swiss-ai/apertus-v1.5-8b',
    label: 'Apertus 1.5 8B',
    vendor: 'swiss-ai',
    classes: ['chat', 'long-context'],
    contextWindow: 262144,
    supportsTools: true,
    pricing: null,
    freeTier: 'free',
    access: 'gated',
    notes: 'Model page requires filling an access request form before use.',
  },
  {
    id: 'eurollm-9b-it',
    upstreamId: '@cf/utter-project/eurollm-9b-it',
    label: 'EuroLLM 9B Instruct',
    vendor: 'utter-project',
    classes: ['chat'],
    contextWindow: 32000,
    supportsTools: true,
    pricing: null,
    freeTier: 'free',
    access: 'gated',
    notes: 'Model page requires filling an access request form before use.',
  },
  /* --------- Workers Paid plan only — never presented as "free" ---------- */
  {
    id: 'glm-5.3',
    upstreamId: '@cf/zai-org/glm-5.3',
    label: 'GLM 5.3 (1M context)',
    vendor: 'Z.ai',
    classes: ['coding', 'reasoning', 'long-context'],
    contextWindow: 1048576,
    supportsTools: true,
    pricing: [1.4, 4.4],
    freeTier: 'paid',
    notes: 'Requires Workers Paid plan or prepaid AI Gateway credits.',
  },
  {
    id: 'glm-5.3-flash',
    upstreamId: '@cf/zai-org/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    vendor: 'Z.ai',
    classes: ['chat', 'coding', 'long-context'],
    contextWindow: 1048576,
    supportsTools: true,
    pricing: [0.15, 0.5],
    freeTier: 'paid',
    notes: 'Requires Workers Paid plan or prepaid AI Gateway credits.',
  },
  {
    id: 'kimi-k2.7-code',
    upstreamId: '@cf/moonshotai/kimi-k2.7-code',
    label: 'Kimi K2.7 Code (1T MoE)',
    vendor: 'Moonshot AI',
    classes: ['coding', 'long-context'],
    contextWindow: 262144,
    supportsTools: true,
    supportsVision: true,
    pricing: [0.95, 4.0],
    freeTier: 'paid',
    notes: 'Requires Workers Paid plan or prepaid AI Gateway credits.',
  },
  {
    id: 'deepseek-v4-flash-0731',
    upstreamId: '@cf/deepseek-ai/deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash',
    vendor: 'DeepSeek',
    classes: ['chat', 'coding', 'long-context'],
    contextWindow: 1048576,
    supportsTools: true,
    pricing: [0.44, 1.32],
    freeTier: 'paid',
    notes: 'Requires Workers Paid plan or prepaid AI Gateway credits.',
  },
  {
    id: 'deepseek-v4-pro-0813',
    upstreamId: '@cf/deepseek-ai/deepseek-v4-pro-0813',
    label: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    classes: ['reasoning', 'long-context'],
    contextWindow: 1048576,
    supportsTools: true,
    pricing: [1.32, 3.96],
    freeTier: 'paid',
    notes: 'Requires Workers Paid plan or prepaid AI Gateway credits.',
  },
];

export const WORKERS_AI_MODELS: ModelInfo[] = SEEDS.map((s) => ({
  id: `workers-ai:${s.id}`,
  provider: 'workers-ai',
  upstreamId: s.upstreamId,
  label: s.label,
  vendor: s.vendor,
  classes: s.classes,
  contextWindow: s.contextWindow,
  supportsTools: s.supportsTools ?? false,
  supportsStreaming: true,
  supportsVision: s.supportsVision ?? false,
  supportsSystemRole: true,
  pricing: s.pricing ? { inputPerMTok: s.pricing[0], outputPerMTok: s.pricing[1] } : null,
  freeTier: s.freeTier,
  access: s.access ?? 'open',
  verifiedAt: VERIFIED_AT,
  verifiedSource: `${SRC}${s.id}/`,
  notes: s.notes,
}));

/** Non-chat models exposed to other subsystems (semantic project search). */
export const WORKERS_AI_EMBEDDING_MODELS = [
  { id: '@cf/baai/bge-m3', label: 'BGE-M3', dims: null, contextWindow: 60000 },
  { id: '@cf/qwen/qwen3-embedding-0.6b', label: 'Qwen3 Embedding 0.6B', dims: 1024, contextWindow: 8192 },
] as const;

export const WORKERS_AI_FREE_PLAN_NOTE = `Free allocation: 10,000 Neurons/day, shared across all models, resets 00:00 UTC. Source: ${PRICING_SRC} (checked ${VERIFIED_AT}).`;
export const WORKERS_AI_VERIFIED_AT = VERIFIED_AT;
