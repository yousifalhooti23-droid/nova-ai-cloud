import { SSE_HEADERS, encodeEvent, type ServerEvent } from '@nova/shared';

/**
 * Streaming helper: turns an async push-style producer into a Response whose
 * body is an SSE stream. Works identically on workerd and Node 20 (web streams).
 */
export function sseResponse(
  producer: (emit: (evt: ServerEvent) => void, signal: AbortSignal) => Promise<void>,
  init: { headers?: Record<string, string>; heartbeatMs?: number } = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (raw: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(raw));
        } catch {
          closed = true;
        }
      };
      const emit = (evt: ServerEvent) => send(encodeEvent(evt));
      const ac = new AbortController();

      const heartbeat = setInterval(() => send(': ping\n\n'), init.heartbeatMs ?? 15000);
      // Heartbeats keep proxies from buffering/closing an idle agent stream.
      (heartbeat as unknown as { unref?: () => void }).unref?.();

      try {
        await producer(emit, ac.signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', message, code: 'stream_error' });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: { ...SSE_HEADERS, ...(init.headers ?? {}) },
  });
}

/** Convert an upstream SSE body into parsed JSON chunks (provider streams). */
export async function* readUpstreamSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf('\n\n');
        if (!frame.trim()) continue;
        let event: string | undefined;
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) continue;
        yield { event, data: dataLines.join('\n') };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
