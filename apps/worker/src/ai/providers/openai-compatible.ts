import type { ModelInfo, ProviderId, ProviderStatus } from '@nova/shared';
import { estimateTokens, truncate } from '@nova/shared';
import type { NovaConfig } from '../../env.js';
import { HttpError } from '../../lib/errors.js';
import { readUpstreamSse } from '../../lib/sse.js';
import type { CompletionRequest, CompletionResult, ProviderAdapter, StreamHandlers } from '../types.js';

/**
 * Adapter for any endpoint that speaks the OpenAI chat-completions protocol:
 * OpenRouter, Groq, Together, vLLM, Ollama, LM Studio, OpenAI itself.
 *
 * One implementation, many providers — this is the extension point that keeps
 * the rest of the app provider-agnostic.
 */
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  constructor(
    readonly id: ProviderId,
    readonly label: string,
    /** Which catalog models belong to this adapter. */
    private modelSource: (cfg: NovaConfig) => ModelInfo[],
    private missingMessage: string,
  ) {}

  private cfgFor(cfg: NovaConfig) {
    return cfg.providers[this.id];
  }

  availableModels(cfg: NovaConfig): ModelInfo[] {
    const p = this.cfgFor(cfg);
    if (!p?.enabled || !p.apiKey) return [];
    const all = this.modelSource(cfg);
    if (!p.allowedModels?.length) return all;
    return all.filter((m) => p.allowedModels!.includes(m.upstreamId));
  }

  status(cfg: NovaConfig): { status: ProviderStatus; detail: string; simulated: boolean } {
    const p = this.cfgFor(cfg);
    if (!p) return { status: 'disabled', detail: `${this.label} is not part of this deployment.`, simulated: false };
    if (!p.enabled || !p.apiKey) return { status: 'missing-key', detail: p.missing ?? this.missingMessage, simulated: false };
    if (!p.baseUrl) return { status: 'error', detail: `${this.label}: base URL is not configured.`, simulated: false };
    return { status: 'ready', detail: `${this.label} is configured (${this.availableModels(cfg).length} models).`, simulated: false };
  }

  async complete(req: CompletionRequest, handlers: StreamHandlers, cfg: NovaConfig): Promise<CompletionResult> {
    const p = this.cfgFor(cfg);
    if (!p?.apiKey || !p.baseUrl) {
      throw new HttpError(503, `${this.label} is not configured.`, 'provider_not_configured', p?.missing ?? this.missingMessage, { notConfigured: true });
    }
    const url = `${p.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model.upstreamId,
      messages: req.messages.map((m) => {
        const useVision = Boolean(req.model.supportsVision && m.images?.length && m.role === 'user');
        const contentValue: unknown = useVision
          ? [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.images!.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
            ]
          : (m.content ?? '');
        const out: Record<string, unknown> = { role: m.role, content: contentValue };
        if (m.toolCalls?.length) {
          out.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
          }));
          // OpenAI-compatible APIs reject tool_calls turns whose content is null on some providers.
          out.content = m.content ?? '';
        }
        if (m.role === 'tool') {
          out.tool_call_id = m.toolCallId;
          out.name = m.toolName;
        }
        return out;
      }),
      stream: req.stream,
    };
    if (req.stream) body.stream_options = { include_usage: true };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = req.toolChoice ?? 'auto';
      body.parallel_tool_calls = false;
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens) body.max_tokens = req.maxTokens;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${p.apiKey}`,
          // OpenRouter attribution (harmless elsewhere).
          'http-referer': 'https://github.com/nova-ai-cloud',
          'x-title': 'NOVA AI Cloud',
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(message)) throw new HttpError(499, 'Request aborted.', 'aborted');
      throw new HttpError(502, `${this.label} request failed: ${message}`, 'upstream_network');
    }

    if (!res.ok) {
      const text = truncate(await res.text().catch(() => ''), 600);
      throw new HttpError(res.status === 429 ? 429 : 502, `${this.label} error ${res.status}: ${text}`, res.status === 429 ? 'rate_limited' : 'upstream_error', res.status === 429 ? 'Free-tier rate limit reached. Wait a moment or switch model class.' : undefined);
    }

    if (!req.stream || !res.body) return this.parseJson(await res.json(), handlers);
    return this.parseStream(res.body, handlers, req.signal);
  }

  /* ------------------------------------------------------------ parsers */

  private parseJson(json: any, handlers: StreamHandlers): CompletionResult {
    const choice = json?.choices?.[0] ?? {};
    const msg = choice?.message ?? {};
    const text: string = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((c: any) => c?.text ?? '').join('') : '';
    const toolCalls = (msg.tool_calls ?? []).map((tc: any, i: number) => ({
      id: tc?.id ?? `call_${i}`,
      name: tc?.function?.name ?? '',
      arguments: safeParseArgs(tc?.function?.arguments),
    }));
    const tokensIn = json?.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(json?.choices ?? ''));
    const tokensOut = json?.usage?.completion_tokens ?? estimateTokens(text);
    handlers.onText?.(text);
    handlers.onUsage?.({ tokensIn, tokensOut });
    return {
      text,
      reasoning: msg.reasoning_content ?? msg.reasoning ?? '',
      toolCalls,
      finishReason: choice?.finish_reason ?? (toolCalls.length ? 'tool_calls' : 'stop'),
      tokensIn,
      tokensOut,
    };
  }

  private async parseStream(body: ReadableStream<Uint8Array>, handlers: StreamHandlers, signal?: AbortSignal): Promise<CompletionResult> {
    let text = '';
    let reasoning = '';
    let finishReason = 'stop';
    let tokensIn = 0;
    let tokensOut = 0;
    // Tool-call deltas arrive fragmented per index; accumulate then emit.
    const pending = new Map<number, { id: string; name: string; args: string }>();

    for await (const frame of readUpstreamSse(body)) {
      if (signal?.aborted) break;
      if (frame.data === '[DONE]') break;
      let json: any;
      try {
        json = JSON.parse(frame.data);
      } catch {
        continue;
      }
      if (json?.usage) {
        tokensIn = json.usage.prompt_tokens ?? tokensIn;
        tokensOut = json.usage.completion_tokens ?? tokensOut;
      }
      const choice = json?.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? choice.message ?? {};
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        handlers.onText?.(delta.content);
      }
      const think = delta.reasoning_content ?? delta.reasoning;
      if (typeof think === 'string' && think) {
        reasoning += think;
        handlers.onReasoning?.(think);
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const slot = pending.get(idx) ?? { id: '', name: '', args: '' };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (typeof tc.function?.arguments === 'string') slot.args += tc.function.arguments;
        pending.set(idx, slot);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const toolCalls = [...pending.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, slot]) => ({
        id: slot.id || `call_${idx}`,
        name: slot.name,
        arguments: safeParseArgs(slot.args),
      }))
      .filter((tc) => tc.name);

    if (!tokensIn || !tokensOut) {
      tokensIn = tokensIn || estimateTokens(text) + 1;
      tokensOut = tokensOut || estimateTokens(text + reasoning);
    }
    handlers.onUsage?.({ tokensIn, tokensOut });
    return { text, reasoning, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : finishReason, tokensIn, tokensOut };
  }
}

/**
 * Parse tool-call arguments defensively.
 *
 * Real models produce slightly-broken JSON often enough to matter:
 *   • raw newlines/tabs inside string literals (the most common failure)
 *   • trailing commas
 *   • single quotes instead of double quotes
 *   • arguments split across streamed deltas with stray whitespace
 * We repair what is unambiguous and, if that still fails, return `{ _raw }` so
 * the tool can report a precise error and the model can retry — we never guess
 * at values the model did not clearly provide.
 */
export function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  const s = String(raw).trim();
  if (!s) return {};

  const attempts = [s, escapeControlCharsInStrings(s), stripTrailingCommas(s), stripTrailingCommas(escapeControlCharsInStrings(s)), singleToDoubleQuotes(stripTrailingCommas(escapeControlCharsInStrings(s)))];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      if (Array.isArray(parsed)) return { items: parsed };
      return { value: parsed };
    } catch {
      /* try the next repair */
    }
  }
  return { _raw: s, _parseError: 'arguments are not valid JSON; re-send the tool call with strict JSON arguments' };
}

/** Escape literal control characters that appear inside JSON string literals. */
export function escapeControlCharsInStrings(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of input) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

export function stripTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, '$1');
}

/** Only swap quotes that are clearly delimiters (naive but conservative). */
export function singleToDoubleQuotes(input: string): string {
  if (!input.includes("'")) return input;
  if (input.includes('"')) return input; // mixed quoting: too risky to rewrite
  return input.replace(/'/g, '"');
}
