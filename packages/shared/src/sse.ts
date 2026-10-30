/**
 * Server-sent event protocol shared by the worker (producer) and the web app
 * (consumer). One TypeScript union = the contract; both sides import it.
 */
import type { AgentRun, AgentRunStatus, FileChange, ProviderId, Task } from './types.js';
import type { DiffHunk } from './diff.js';

export type ServerEvent =
  | { type: 'ready'; requestId: string; modelId: string; provider: ProviderId; warnings: string[] }
  | { type: 'message.start'; messageId: string; modelId: string; provider: ProviderId }
  | { type: 'text.delta'; messageId: string; text: string }
  | { type: 'reasoning.delta'; messageId: string; text: string }
  | { type: 'message.done'; messageId: string; tokensIn: number; tokensOut: number; finishReason: string }
  | { type: 'title.generated'; conversationId: string; title: string }
  /* ---- agent ---- */
  | { type: 'agent.start'; runId: string; modelId: string; provider: ProviderId; maxSteps: number }
  | { type: 'agent.status'; runId: string; status: AgentRunStatus; step: number; note?: string }
  | { type: 'agent.thought'; runId: string; text: string }
  | { type: 'agent.tool.start'; runId: string; callId: string; name: string; args: Record<string, unknown> }
  | {
      type: 'agent.tool.result';
      runId: string;
      callId: string;
      name: string;
      ok: boolean;
      output: string;
      truncated: boolean;
      meta?: Record<string, unknown>;
    }
  | { type: 'agent.change.proposed'; runId: string; change: FileChange; diff: DiffHunk[]; additions: number; deletions: number }
  | { type: 'agent.tasks.updated'; runId: string; tasks: Task[] }
  | { type: 'agent.await.approval'; runId: string; changeIds: string[]; reason: string }
  | { type: 'agent.done'; runId: string; run: AgentRun; summary: string }
  /* ---- shared ---- */
  | { type: 'usage'; tokensIn: number; tokensOut: number; modelId: string; provider: ProviderId }
  | { type: 'error'; message: string; code?: string; retryable?: boolean }
  | { type: 'ping' };

export type ServerEventType = ServerEvent['type'];

/** Encode one event into an SSE frame. */
export function encodeEvent(evt: ServerEvent): string {
  return `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
}

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const;

/**
 * Incremental SSE parser. Feed it raw chunks from a fetch body; it calls
 * `onEvent` for every complete frame and tolerates comments/heartbeats.
 */
export function createSseParser(onEvent: (evt: ServerEvent) => void, onError?: (err: unknown) => void) {
  let buffer = '';
  return {
    push(chunk: string) {
      buffer += chunk;
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        if (!frame.trim()) continue;
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        try {
          onEvent(JSON.parse(dataLines.join('\n')) as ServerEvent);
        } catch (err) {
          onError?.(err);
        }
      }
    },
    flush() {
      buffer = '';
    },
  };
}
