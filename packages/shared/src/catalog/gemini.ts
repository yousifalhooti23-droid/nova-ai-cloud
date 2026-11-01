import type { ModelInfo } from '../types.js';

const VERIFIED_AT = '2026-11-01';
const VERIFIED_SRC = 'https://ai.google.dev/pricing';

/**
 * Google AI Studio (Gemini) Free Tier.
 *
 * Official Free Limits (no credit card required):
 *   - 15 RPM (Requests Per Minute)
 *   - 1,000,000 TPM (Tokens Per Minute)
 *   - 1,500 RPD (Requests Per Day)
 * Verified at https://ai.google.dev/pricing
 */
export const GEMINI_FREE_LIMITS = {
  requestsPerMinute: 15,
  requestsPerDay: 1500,
  tokensPerMinute: 1000000,
  requiresCard: false,
  verifiedAt: VERIFIED_AT,
  source: VERIFIED_SRC,
};

export const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini:gemini-2.5-flash',
    provider: 'gemini',
    upstreamId: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    vendor: 'Google',
    classes: ['chat', 'coding'],
    contextWindow: 1048576,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    supportsSystemRole: true,
    pricing: null,
    freeTier: 'free',
    access: 'open',
    verifiedAt: VERIFIED_AT,
    verifiedSource: VERIFIED_SRC,
    notes: 'Google official free tier: 15 req/min, 1500 req/day. Ultra-fast with 1M context.',
  },
  {
    id: 'gemini:gemini-1.5-flash',
    provider: 'gemini',
    upstreamId: 'gemini-1.5-flash',
    label: 'Gemini 1.5 Flash',
    vendor: 'Google',
    classes: ['chat', 'coding'],
    contextWindow: 1048576,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    supportsSystemRole: true,
    pricing: null,
    freeTier: 'free',
    access: 'open',
    verifiedAt: VERIFIED_AT,
    verifiedSource: VERIFIED_SRC,
    notes: 'Google official free tier: 15 req/min, 1500 req/day.',
  },
  {
    id: 'gemini:gemini-1.5-pro',
    provider: 'gemini',
    upstreamId: 'gemini-1.5-pro',
    label: 'Gemini 1.5 Pro',
    vendor: 'Google',
    classes: ['reasoning', 'coding', 'long-context'],
    contextWindow: 2097152,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    supportsSystemRole: true,
    pricing: null,
    freeTier: 'free',
    access: 'open',
    verifiedAt: VERIFIED_AT,
    verifiedSource: VERIFIED_SRC,
    notes: 'Google official free tier: 2M context window for massive codebases.',
  },
  {
    id: 'gemini:gemini-2.0-flash-exp',
    provider: 'gemini',
    upstreamId: 'gemini-2.0-flash-exp',
    label: 'Gemini 2.0 Flash Exp',
    vendor: 'Google',
    classes: ['chat', 'coding'],
    contextWindow: 1048576,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    supportsSystemRole: true,
    pricing: null,
    freeTier: 'free',
    access: 'open',
    verifiedAt: VERIFIED_AT,
    verifiedSource: VERIFIED_SRC,
    notes: 'Google experimental next-gen multimodal model.',
  },
];
