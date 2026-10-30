import type { ModelInfo, ProviderStatus } from '@nova/shared';
import { estimateTokens } from '@nova/shared';
import type { NovaConfig } from '../../env.js';
import { HttpError } from '../../lib/errors.js';
import type { CompletionRequest, CompletionResult, ProviderAdapter, StreamHandlers } from '../types.js';
import { safeParseArgs } from './openai-compatible.js';

const DIAGNOSTIC_MODEL: ModelInfo = {
  id: 'diagnostic:echo',
  provider: 'diagnostic',
  upstreamId: 'echo',
  label: 'Diagnostic Echo (NOT an AI model)',
  vendor: 'NOVA',
  classes: ['chat', 'reasoning', 'coding', 'long-context'],
  contextWindow: 32000,
  supportsTools: true,
  supportsStreaming: true,
  supportsVision: false,
  supportsSystemRole: true,
  pricing: { inputPerMTok: 0, outputPerMTok: 0 },
  freeTier: 'free',
  access: 'open',
  notes:
    'Plumbing-test provider. Echoes your prompt and can emit deterministic tool calls. ' +
    'It is not a language model and produces no intelligence. Disabled unless NOVA_ENABLE_DIAGNOSTIC=true.',
};

/**
 * Opt-in echo provider.
 *
 * Why it exists: you must be able to verify streaming, D1 persistence, the
 * agent loop and the approval flow *before* spending money on tokens.
 * Why it is safe: it is disabled by default, it is named "Diagnostic Echo
 * (NOT an AI model)" everywhere, and every answer starts with an explicit
 * banner. It never masquerades as a real model output.
 *
 * Tool-call testing: include a line like
 *     /tool list_files {"path":""}
 * in the user message and this adapter emits exactly that call.
 */
export class DiagnosticAdapter implements ProviderAdapter {
  readonly id = 'diagnostic' as const;
  readonly label = 'Diagnostic echo (NOT an AI model)';

  availableModels(cfg: NovaConfig): ModelInfo[] {
    return cfg.providers.diagnostic?.enabled ? [DIAGNOSTIC_MODEL] : [];
  }

  status(cfg: NovaConfig): { status: ProviderStatus; detail: string; simulated: boolean } {
    const enabled = cfg.providers.diagnostic?.enabled ?? false;
    return {
      status: enabled ? 'ready' : 'disabled',
      detail: enabled
        ? 'Diagnostic echo enabled. Output is a labelled echo of your prompt — not a model answer.'
        : 'Disabled. Set NOVA_ENABLE_DIAGNOSTIC=true to test plumbing without an API key.',
      simulated: true,
    };
  }

  async complete(req: CompletionRequest, handlers: StreamHandlers, cfg: NovaConfig): Promise<CompletionResult> {
    if (!cfg.providers.diagnostic?.enabled) {
      throw new HttpError(503, 'Diagnostic provider is disabled.', 'provider_not_configured', 'Set NOVA_ENABLE_DIAGNOSTIC=true to enable it.', { notConfigured: true });
    }
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content ?? '';
    const toolDirective = prompt.match(/^\s*\/tool\s+([a-z_]+)\s*(\{[\s\S]*\})?\s*$/im);

    const banner = '⚠️ DIAGNOSTIC ECHO — this is not an AI model response.';
    const body = toolDirective
      ? `${banner}\n\nEmitting the requested deterministic tool call: ${toolDirective[1]}`
      : `${banner}\n\nEcho of your prompt:\n\n> ${prompt.replace(/\n/g, '\n> ')}\n\n---\nModel: ${req.model.id}\nMessages: ${req.messages.length}\nTools available: ${req.tools?.map((t) => t.name).join(', ') || 'none'}\nEstimated prompt tokens: ${estimateTokens(prompt)}`;

    const toolCalls = toolDirective
      ? [{ id: `diag_${Date.now().toString(36)}`, name: toolDirective[1], arguments: safeParseArgs(toolDirective[2] ?? '{}') }]
      : [];

    if (req.stream) {
      // Emit in small chunks so the streaming path is genuinely exercised.
      for (const chunk of body.match(/[\s\S]{1,24}/g) ?? []) {
        if (req.signal?.aborted) break;
        handlers.onText?.(chunk);
        await new Promise((r) => setTimeout(r, 8));
      }
    } else {
      handlers.onText?.(body);
    }

    const tokensIn = estimateTokens(prompt);
    const tokensOut = estimateTokens(body);
    handlers.onUsage?.({ tokensIn, tokensOut });
    return {
      text: body,
      reasoning: '',
      toolCalls,
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
      tokensIn,
      tokensOut,
    };
  }
}

export { DIAGNOSTIC_MODEL };
