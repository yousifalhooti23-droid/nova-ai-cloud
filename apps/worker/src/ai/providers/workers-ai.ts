import type { ModelInfo, ProviderStatus } from '@nova/shared';
import { WORKERS_AI_MODELS, estimateTokens, truncate } from '@nova/shared';
import type { NovaConfig, RawEnv } from '../../env.js';
import { HttpError } from '../../lib/errors.js';
import type { CompletionRequest, CompletionResult, ProviderAdapter, StreamHandlers } from '../types.js';
import { safeParseArgs } from './openai-compatible.js';

/** Structural type for the Cloudflare `AI` binding. */
interface AiBinding {
  run(model: string, params: Record<string, unknown>): Promise<unknown>;
}

const LOCAL_MODE_HINT =
  'Workers AI binding is remote-only: under `wrangler dev --local` every call fails with "Binding AI needs to be run remotely". ' +
  'Run `npm run dev:remote-ai` (wrangler dev --remote) after `wrangler login`, or deploy the Worker. ' +
  'Alternatively configure OPENROUTER_API_KEY and put openrouter first in NOVA_PROVIDER_PRIORITY.';

/**
 * Cloudflare Workers AI adapter.
 *
 * Free plan: 10,000 Neurons/day. Availability of each model was verified from
 * the official model pages on 2026-10-30 — see packages/shared/src/catalog.
 */
export class WorkersAiAdapter implements ProviderAdapter {
  readonly id = 'workers-ai' as const;
  readonly label = 'Cloudflare Workers AI';
  /**
   * Sticky flag: once a call fails with "needs to be run remotely" we know this
   * isolate is `wrangler dev --local`, so the router stops offering Workers AI
   * and falls back to a provider that can actually answer.
   */
  private localModeDetected = false;

  constructor(private getBinding: (cfg: NovaConfig, env: RawEnv) => AiBinding | undefined, private env: RawEnv) {}

  /**
   * Non-inference probe. `ai.models()` reads the catalog — it does NOT run a
   * model, so it costs no neurons — but it still fails fast in local mode, which
   * makes it a safe way to discover whether the binding is usable.
   */
  async probeBinding(): Promise<{ mode: 'remote' | 'local' | 'unknown'; detail: string; models?: string[] }> {
    const ai = this.getBinding({} as NovaConfig, this.env) as (AiBinding & { models?: () => Promise<unknown> }) | undefined;
    if (!ai) return { mode: 'unknown', detail: 'No AI binding in this runtime.' };
    if (typeof ai.models !== 'function') {
      return { mode: 'unknown', detail: 'This AI binding has no models() method; run POST /api/models/probe with a model id to verify access.' };
    }
    try {
      const res = await ai.models();
      const names = Array.isArray(res)
        ? (res as { id?: string; name?: string }[]).map((m) => m.id ?? m.name ?? '').filter(Boolean)
        : Array.isArray((res as { models?: unknown[] })?.models)
          ? ((res as { models: { id?: string; name?: string }[] }).models).map((m) => m.id ?? m.name ?? '').filter(Boolean)
          : [];
      this.localModeDetected = false;
      return { mode: 'remote', detail: `AI binding reachable (${names.length} models listed by the binding).`, models: names.slice(0, 200) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/needs to be run remotely/i.test(message)) {
        this.localModeDetected = true;
        return { mode: 'local', detail: `Local mode detected: ${message}. ${LOCAL_MODE_HINT}` };
      }
      return { mode: 'unknown', detail: `Probe failed: ${message}` };
    }
  }

  availableModels(cfg: NovaConfig): ModelInfo[] {
    const ai = this.getBinding(cfg, this.env);
    if (!ai) return [];
    // Only models verified as callable; gated ones are kept but flagged.
    return WORKERS_AI_MODELS;
  }

  status(cfg: NovaConfig): { status: ProviderStatus; detail: string; simulated: boolean } {
    const ai = this.getBinding(cfg, this.env);
    if (!ai) {
      return {
        status: 'missing-key',
        detail: cfg.providers['workers-ai'].missing ?? 'AI binding is unavailable in this runtime.',
        simulated: false,
      };
    }
    if (cfg.runtime === 'node') {
      return { status: 'disabled', detail: 'Unavailable under the Node dev runtime (the AI binding only exists inside workerd).', simulated: false };
    }
    if (this.localModeDetected) {
      return { status: 'needs-remote', detail: LOCAL_MODE_HINT, simulated: false };
    }
    return {
      status: 'ready',
      detail: 'AI binding present. Free allocation: 10,000 Neurons/day. If this is `wrangler dev --local`, the first call will fail and the router will mark it needs-remote automatically.',
      simulated: false,
    };
  }

  async complete(req: CompletionRequest, handlers: StreamHandlers, cfg: NovaConfig): Promise<CompletionResult> {
    const ai = this.getBinding(cfg, this.env);
    if (!ai) {
      throw new HttpError(503, 'Cloudflare Workers AI is not available in this runtime.', 'provider_not_configured', LOCAL_MODE_HINT, { notConfigured: true });
    }

    const params: Record<string, unknown> = {
      messages: req.messages.map((m) => {
        const out: Record<string, unknown> = { role: m.role, content: m.content ?? '' };
        if (m.toolCalls?.length) {
          out.tool_calls = m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) } }));
        }
        if (m.role === 'tool') {
          out.tool_call_id = m.toolCallId;
          out.name = m.toolName;
        }
        return out;
      }),
    };
    if (req.tools?.length) {
      params.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      params.tool_choice = req.toolChoice ?? 'auto';
    }
    if (req.temperature !== undefined) params.temperature = req.temperature;
    if (req.maxTokens) params.max_tokens = req.maxTokens;
    if (req.stream) params.stream = true;

    let result: unknown;
    try {
      result = await ai.run(req.model.upstreamId, params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/needs to be run remotely/i.test(message)) {
        this.localModeDetected = true; // stop offering this provider in this isolate
        throw new HttpError(503, 'Workers AI cannot run in local mode.', 'workers_ai_needs_remote', LOCAL_MODE_HINT);
      }
      if (/rate limit|429/i.test(message)) {
        throw new HttpError(429, `Workers AI rate limit: ${message}`, 'rate_limited', 'Free allocation is 10,000 Neurons/day. Switch model class or wait for the daily reset.');
      }
      if (/not found|unknown model|invalid model/i.test(message)) {
        throw new HttpError(502, `Workers AI rejected model "${req.model.upstreamId}": ${message}`, 'model_unavailable', 'Run POST /api/models/refresh or re-verify the catalog — Cloudflare rotates model ids.');
      }
      throw new HttpError(502, `Workers AI error: ${truncate(message, 500)}`, 'upstream_error');
    }

    if (req.stream && isReadableStream(result)) {
      return this.parseStream(result, handlers);
    }
    return this.parseJson(result, handlers);
  }

  private parseJson(raw: unknown, handlers: StreamHandlers): CompletionResult {
    const r = raw as any;
    const result = r?.result ?? r ?? {};
    const text: string = typeof result.response === 'string' ? result.response : typeof result.content === 'string' ? result.content : '';
    const rawToolCalls = result.tool_calls ?? r?.tool_calls ?? [];
    const toolCalls = (Array.isArray(rawToolCalls) ? rawToolCalls : []).map((tc: any, i: number) => ({
      id: tc?.id ?? `call_${i}`,
      name: tc?.function?.name ?? tc?.name ?? '',
      arguments: safeParseArgs(tc?.function?.arguments ?? tc?.arguments),
    })).filter((tc: any) => tc.name);
    const usage = r?.usage ?? result.usage ?? {};
    const tokensIn = Number(usage.input_tokens ?? usage.prompt_tokens ?? estimateTokens(JSON.stringify(r ?? '')));
    const tokensOut = Number(usage.completion_tokens ?? usage.output_tokens ?? estimateTokens(text));
    if (text) handlers.onText?.(text);
    handlers.onUsage?.({ tokensIn, tokensOut });
    return { text, reasoning: result.reasoning ?? '', toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', tokensIn, tokensOut };
  }

  /**
   * Workers AI streams SSE frames whose payload is either
   *   {"response":"delta"}                        (text delta)
   *   {"response":"","tool_calls":[{...}]}        (tool call delta/final)
   *   {"usage":{...}} / [DONE]
   * Some models/gateways emit OpenAI-shaped chunks; both are handled.
   */
  private async parseStream(stream: ReadableStream<unknown>, handlers: StreamHandlers): Promise<CompletionResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let reasoning = '';
    let tokensIn = 0;
    let tokensOut = 0;
    const pending = new Map<number, { id: string; name: string; args: string }>();

    const handle = (json: any) => {
      if (json?.usage) {
        tokensIn = Number(json.usage.input_tokens ?? json.usage.prompt_tokens ?? tokensIn);
        tokensOut = Number(json.usage.output_tokens ?? json.usage.completion_tokens ?? tokensOut);
        handlers.onUsage?.({ tokensIn, tokensOut });
      }
      const choice = json?.choices?.[0];
      const delta = choice?.delta ?? json;
      if (typeof delta?.response === 'string' && delta.response) {
        text += delta.response;
        handlers.onText?.(delta.response);
      }
      if (typeof delta?.content === 'string' && delta.content) {
        text += delta.content;
        handlers.onText?.(delta.content);
      }
      const think = delta?.reasoning_content ?? delta?.reasoning;
      if (typeof think === 'string' && think) {
        reasoning += think;
        handlers.onReasoning?.(think);
      }
      const tcs = delta?.tool_calls;
      if (Array.isArray(tcs)) {
        for (const tc of tcs) {
          const idx = tc?.index ?? pending.size;
          const slot = pending.get(idx) ?? { id: '', name: '', args: '' };
          if (tc?.id) slot.id = tc.id;
          const fn = tc?.function ?? tc;
          if (fn?.name) slot.name += typeof fn.name === 'string' ? fn.name : '';
          if (typeof fn?.arguments === 'string') slot.args += fn.arguments;
          else if (fn?.arguments && typeof fn.arguments === 'object') slot.args = JSON.stringify(fn.arguments);
          pending.set(idx, slot);
        }
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += typeof value === 'string' ? value : decoder.decode(value as Uint8Array, { stream: true });
        let idx = buffer.indexOf('\n');
        while (idx !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          idx = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            handle(JSON.parse(data));
          } catch {
            /* partial frame; ignore */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls = [...pending.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, s]) => ({ id: s.id || `call_${i}`, name: s.name, arguments: safeParseArgs(s.args) }))
      .filter((tc) => tc.name);

    if (!tokensOut) tokensOut = estimateTokens(text + reasoning);
    if (!tokensIn) tokensIn = estimateTokens(text) + 1;
    return { text, reasoning, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', tokensIn, tokensOut };
  }
}

function isReadableStream(value: unknown): value is ReadableStream<unknown> {
  return Boolean(value) && typeof (value as ReadableStream).getReader === 'function';
}
