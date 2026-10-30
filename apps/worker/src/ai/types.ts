import type { ModelInfo, ProviderId, ProviderInfo, ProviderStatus, Role, ToolCallRequest } from '@nova/shared';
import type { NovaConfig } from '../env.js';

export interface ChatTurn {
  role: Role;
  content: string;
  /** Present on assistant turns that requested tools. */
  toolCalls?: ToolCallRequest[];
  /** Present on `tool` role turns. */
  toolCallId?: string;
  toolName?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  model: ModelInfo;
  messages: ChatTurn[];
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  signal?: AbortSignal;
}

export interface StreamHandlers {
  onText?(chunk: string): void;
  onReasoning?(chunk: string): void;
  onUsage?(usage: { tokensIn: number; tokensOut: number }): void;
}

export interface CompletionResult {
  text: string;
  reasoning: string;
  toolCalls: ToolCallRequest[];
  finishReason: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  /** Models this adapter can actually serve right now (empty when unavailable). */
  availableModels(cfg: NovaConfig): ModelInfo[];
  status(cfg: NovaConfig): { status: ProviderStatus; detail: string; simulated: boolean };
  /** Run a completion, streaming through `handlers` when possible. */
  complete(req: CompletionRequest, handlers: StreamHandlers, cfg: NovaConfig): Promise<CompletionResult>;
}

export interface ResolveOptions {
  modelId?: string | null;
  modelClass?: ModelInfo['classes'][number];
  requireTools?: boolean;
  requireVision?: boolean;
  minContext?: number;
}

export interface ResolutionResult {
  model: ModelInfo;
  adapter: ProviderAdapter;
  via: 'explicit' | 'class-default' | 'fallback' | 'override';
  warnings: string[];
}

export type ProviderInfoFactory = (adapter: ProviderAdapter, cfg: NovaConfig) => ProviderInfo;
