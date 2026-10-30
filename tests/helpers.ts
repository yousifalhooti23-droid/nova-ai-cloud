import type { ModelInfo, ProviderId, ProviderStatus } from '@nova/shared';
import type { ProviderAdapter, CompletionRequest, CompletionResult, StreamHandlers } from '../apps/worker/src/ai/types.js';
import type { NovaConfig } from '../apps/worker/src/env.js';
import { loadConfig } from '../apps/worker/src/env.js';

/**
 * Scripted provider used ONLY in tests. It is a test double, never shipped as a
 * user-facing model, and it is not the diagnostic echo provider.
 */
export interface ScriptedStep {
  text?: string;
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  finishReason?: string;
}

export class ScriptedAdapter implements ProviderAdapter {
  readonly id: ProviderId = 'custom';
  readonly label = 'Scripted test adapter';
  calls: CompletionRequest[] = [];

  constructor(private steps: ScriptedStep[], private models: ModelInfo[] = [testModel()]) {}

  availableModels(_cfg: NovaConfig): ModelInfo[] {
    return this.models;
  }

  status(_cfg: NovaConfig): { status: ProviderStatus; detail: string; simulated: boolean } {
    return { status: 'ready', detail: 'scripted test adapter', simulated: true };
  }

  async complete(req: CompletionRequest, handlers: StreamHandlers): Promise<CompletionResult> {
    this.calls.push(req);
    const step = this.steps[Math.min(this.calls.length - 1, this.steps.length - 1)] ?? { text: '(script exhausted)' };
    if (step.text) {
      for (const chunk of step.text.match(/[\s\S]{1,16}/g) ?? []) handlers.onText?.(chunk);
    }
    handlers.onUsage?.({ tokensIn: 10, tokensOut: 5 });
    return {
      text: step.text ?? '',
      reasoning: '',
      toolCalls: step.toolCalls ?? [],
      finishReason: step.finishReason ?? (step.toolCalls?.length ? 'tool_calls' : 'stop'),
      tokensIn: 10,
      tokensOut: 5,
    };
  }
}

export function testModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'custom:test-model',
    provider: 'custom',
    upstreamId: 'test-model',
    label: 'Test Model',
    vendor: 'Test',
    classes: ['chat', 'reasoning', 'coding', 'long-context'],
    contextWindow: 128000,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    supportsSystemRole: true,
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    freeTier: 'free',
    access: 'open',
    ...overrides,
  };
}

export function testConfig(overrides: Partial<Record<string, string>> = {}): NovaConfig {
  return loadConfig({ NOVA_RUNTIME: 'node', NOVA_SANDBOX: 'disabled', ...overrides } as never);
}

/**
 * Adapter that "serves" a fixed list of catalog models and returns a canned
 * completion. Used to test router resolution against the real static catalog.
 */
export class CatalogAdapter implements ProviderAdapter {
  calls = 0;
  constructor(
    readonly id: ProviderId,
    readonly label: string,
    private models: ModelInfo[],
    private reply = 'ok',
    private ready = true,
    private detail = '',
  ) {}
  availableModels(): ModelInfo[] {
    return this.ready ? this.models : [];
  }
  status(): { status: ProviderStatus; detail: string; simulated: boolean } {
    return { status: this.ready ? 'ready' : 'missing-key', detail: this.detail || `${this.label} test adapter`, simulated: true };
  }
  async complete(_req: CompletionRequest, handlers: StreamHandlers): Promise<CompletionResult> {
    this.calls++;
    handlers.onText?.(this.reply);
    handlers.onUsage?.({ tokensIn: 1, tokensOut: 1 });
    return { text: this.reply, reasoning: '', toolCalls: [], finishReason: 'stop', tokensIn: 1, tokensOut: 1 };
  }
}
