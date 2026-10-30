/**
 * Minimal fetch mock used by the UI tests.
 *
 * Routes are declared as `"METHOD /api/path"` with `:param` and `*` wildcards.
 * Anything unhandled returns a 404 JSON body so a missing mock fails loudly
 * instead of silently rendering an empty screen.
 */
export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  body: unknown;
}

type HandlerResult = unknown | Response | Promise<unknown | Response>;
export type Handler = (ctx: { method: string; path: string; query: URLSearchParams; body: any; call: RecordedCall }) => HandlerResult;

export interface ApiMock {
  calls: RecordedCall[];
  callsTo: (pathPart: string) => RecordedCall[];
  bodyOf: (pathPart: string) => any;
  reset: () => void;
}

let current: ApiMock | null = null;

export function installApiMock(routes: Record<string, Handler>): ApiMock {
  const calls: RecordedCall[] = [];
  const mock: ApiMock = {
    calls,
    callsTo: (part) => calls.filter((c) => c.path.includes(part)),
    bodyOf: (part) => calls.filter((c) => c.path.includes(part)).at(-1)?.body,
    reset: () => {
      calls.length = 0;
    },
  };
  current = mock;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
    const parsed = new URL(url, 'http://test.local');
    const path = parsed.pathname;

    let body: unknown = undefined;
    if (init?.body) {
      if (typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      } else {
        body = init.body;
      }
    }
    const call: RecordedCall = { method, url, path, body };
    calls.push(call);

    for (const [pattern, handler] of Object.entries(routes)) {
      const [pMethod, pPath] = pattern.split(' ');
      if (pMethod.toUpperCase() !== method) continue;
      if (!matchPath(pPath, path)) continue;
      const result = await handler({ method, path, query: parsed.searchParams, body, call });
      if (result instanceof Response) return result;
      return jsonResponse(result);
    }
    return jsonResponse({ error: `unhandled ${method} ${path}`, code: 'not_found' }, 404);
  }) as unknown as typeof fetch;

  return mock;
}

function matchPath(pattern: string, path: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length && p[p.length - 1] !== '*') return false;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*' || p[i]?.startsWith(':')) continue;
    if (p[i] !== a[i]) return false;
  }
  return true;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a text/event-stream Response from pre-encoded frames. */
export function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

/**
 * Encode one frame the way the worker's `encodeEvent` does: the `type` field
 * lives INSIDE the JSON payload (the shared parser reads only `data:` lines).
 */
export function frame(event: string, data: unknown): string {
  const payload = { type: event, ...(data as Record<string, unknown>) };
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function currentMock(): ApiMock {
  if (!current) throw new Error('no api mock installed');
  return current;
}
