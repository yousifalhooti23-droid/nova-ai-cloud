/**
 * Streaming POST helper built on the shared SSE contract.
 *
 * Uses fetch + ReadableStream (not EventSource) because the requests are POSTs
 * with a JSON body — EventSource cannot do that. The parser comes from
 * @nova/shared so the worker and the browser cannot drift apart.
 */
import { createSseParser, type ServerEvent } from '@nova/shared';

export interface StreamHandle {
  /** Abort the in-flight stream (server notices via the closed socket). */
  abort: () => void;
  done: Promise<{ ok: boolean; status: number; error?: string }>;
}

export function streamRequest(
  url: string,
  init: RequestInit,
  onEvent: (evt: ServerEvent) => void,
): StreamHandle {
  const controller = new AbortController();
  const done = (async () => {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal, headers: { accept: 'text/event-stream', ...(init.headers ?? {}) } });
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, status: 0, error: 'aborted' };
      onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err), code: 'network_error' });
      return { ok: false, status: 0, error: 'network_error' };
    }

    if (!res.ok || !res.body) {
      let message = `HTTP ${res.status}`;
      let code: string | undefined;
      try {
        const text = await res.text();
        const parsed = JSON.parse(text) as { error?: string; code?: string };
        message = parsed.error ?? message;
        code = parsed.code;
      } catch {
        /* body was not JSON — keep the status text */
      }
      onEvent({ type: 'error', message, code });
      return { ok: false, status: res.status, error: message };
    }

    const parser = createSseParser(onEvent);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, status: res.status, error: 'aborted' };
      onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err), code: 'stream_error' });
      return { ok: false, status: res.status, error: 'stream_error' };
    }
    return { ok: true, status: res.status };
  })();

  return { abort: () => controller.abort(), done };
}
