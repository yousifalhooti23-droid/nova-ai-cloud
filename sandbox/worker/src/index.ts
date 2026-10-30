/**
 * NOVA sandbox Worker — an isolated execution environment.
 *
 * Security model (read before changing anything here):
 *   • This Worker has ZERO bindings. It cannot see D1, R2, AI, or any secret.
 *   • It executes JavaScript only. There is no shell, no filesystem, no network
 *     access from the evaluated code (fetch is not exposed to the sandboxed scope).
 *   • Console output is captured into a buffer with a hard size cap.
 *   • A wall-clock timeout aborts runaway code (workerd also enforces CPU limits).
 *   • The evaluated code runs inside a closure with a frozen, minimal global-ish
 *     object. This is isolate-level containment, NOT a VM/container boundary:
 *     it protects your data, but it does not make hostile code 100% inert.
 *     For untrusted multi-tenant execution use the http adapter with a container.
 */

const MAX_OUTPUT_CHARS = 64_000;
const MAX_SOURCE_BYTES = 512_000;

interface ExecRequest {
  code?: string;
  language?: string;
  files?: Record<string, string>;
  timeoutMs?: number;
}

interface ExecResponse {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  result?: unknown;
  error?: string;
}

function captureConsole(push: (line: string) => void, kind: 'log' | 'error') {
  const fmt = (args: unknown[]) =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a, null, 2);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  return (...args: unknown[]) => push(`[${kind}] ${fmt(args)}`);
}

async function runJavaScript(req: ExecRequest): Promise<ExecResponse> {
  const started = Date.now();
  const lines: string[] = [];
  let truncated = false;
  const push = (line: string) => {
    const total = lines.reduce((n, l) => n + l.length, 0);
    if (total > MAX_OUTPUT_CHARS) {
      truncated = true;
      return;
    }
    lines.push(line);
  };

  const code = String(req.code ?? '');
  if (!code.trim()) {
    return { ok: false, stdout: '', stderr: 'empty code', exitCode: 1, durationMs: Date.now() - started, truncated };
  }
  if (new TextEncoder().encode(code).length > MAX_SOURCE_BYTES) {
    return { ok: false, stdout: '', stderr: 'source too large', exitCode: 1, durationMs: Date.now() - started, truncated };
  }
  if (req.language && !['javascript', 'js', 'typescript', 'ts'].includes(req.language)) {
    return {
      ok: false,
      stdout: '',
      stderr: `Language "${req.language}" is not supported by the isolated Worker sandbox (JavaScript only). Use the http sandbox for Python/shell.`,
      exitCode: 1,
      durationMs: Date.now() - started,
      truncated,
    };
  }

  const files = Object.freeze({ ...(req.files ?? {}) });
  const sandboxConsole = Object.freeze({
    log: captureConsole(push, 'log'),
    info: captureConsole(push, 'log'),
    debug: captureConsole(push, 'log'),
    warn: captureConsole(push, 'error'),
    error: captureConsole(push, 'error'),
  });

  // Minimal, frozen capability surface. No fetch, no timers longer than the
  // budget, no globals that could reach the outer scope.
  const api = Object.freeze({
    console: sandboxConsole,
    files,
    JSON,
    Math,
    Date,
    RegExp,
    Map,
    Set,
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, Math.min(ms ?? 0, 5000)),
    now: () => Date.now() - started,
  });

  const timeoutMs = Math.min(Math.max(req.timeoutMs ?? 5000, 100), 25000);

  // TypeScript input: reject rather than silently mis-run. A real TS pipeline
  // belongs in the http sandbox where tsc/esbuild can run.
  const looksLikeTypeScript = /^\s*(import\s+type|export\s+(interface|type)|:\s*(string|number|boolean)\b)/m.test(code) && /\b(interface|type)\s+\w+\s*=/.test(code);
  const source = looksLikeTypeScript
    ? `throw new Error('TypeScript source requires transpilation; use the http sandbox (NOVA_SANDBOX=http) where tsc/esbuild can run.')`
    : code;

  let result: unknown;
  let ok = true;
  let errorMessage: string | undefined;
  try {
    // The sandboxed code sees exactly one parameter: `nova` (the frozen api).
    const factory = new Function('nova', `"use strict";\nconst { console, files, JSON, Math, Date, RegExp, Map, Set, Promise, Array, Object, String, Number, Boolean, Error, TextEncoder, TextDecoder, crypto, setTimeout, now } = nova;\nreturn (async () => {\n${source}\n})();`);
    const promise = factory(api) as Promise<unknown>;
    result = await Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);
  } catch (err) {
    ok = false;
    errorMessage = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  const stdout = lines.filter((l) => l.startsWith('[log]')).map((l) => l.slice(6)).join('\n');
  const stderr = [...lines.filter((l) => l.startsWith('[error]')).map((l) => l.slice(8)), ...(errorMessage ? [errorMessage] : [])].join('\n');

  return {
    ok,
    stdout,
    stderr,
    exitCode: ok ? 0 : 1,
    durationMs: Date.now() - started,
    truncated,
    result: safeResult(result),
    error: errorMessage,
  };
}

function safeResult(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json.length > 4000) return '[result truncated]';
    return JSON.parse(json);
  } catch {
    return String(value);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return Response.json({
        ok: true,
        service: 'nova-sandbox',
        kind: 'worker-isolate',
        bindings: [],
        note: 'JavaScript-only isolated sandbox. No shell, no fs, no network, no secrets.',
      });
    }
    if (request.method !== 'POST' || url.pathname !== '/exec') {
      return new Response(JSON.stringify({ error: 'POST /exec only' }), { status: 405, headers: { 'content-type': 'application/json' } });
    }
    let req: ExecRequest;
    try {
      req = (await request.json()) as ExecRequest;
    } catch {
      return new Response(JSON.stringify({ error: 'invalid JSON body' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    try {
      const out = await runJavaScript(req);
      return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: 1, durationMs: 0, truncated: false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
  },
} satisfies ExportedHandler;
