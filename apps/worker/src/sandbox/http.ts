import type { SandboxExecRequest, SandboxExecResponse } from '@nova/shared';
import { truncate } from '@nova/shared';
import { HttpError } from '../lib/errors.js';
import type { NovaConfig } from '../env.js';
import type { SandboxAdapter } from './types.js';

/**
 * External sandbox adapter.
 *
 * Contract (see docs/SANDBOX.md and scripts/sandbox-reference-server.mjs):
 *   POST {NOVA_SANDBOX_URL}/exec
 *   Authorization: Bearer {NOVA_SANDBOX_TOKEN}
 *   body: { command?, code?, language?, files?: Record<string,string>, timeoutMs }
 *   200:  { ok, stdout, stderr, exitCode, durationMs, truncated? }
 *
 * The service behind that URL is what provides real isolation (container/microVM).
 * NOVA does not claim isolation it does not implement: if you point this at a
 * server running on a bare host, the code runs on that host.
 */
export class HttpSandbox implements SandboxAdapter {
  readonly kind = 'http' as const;
  constructor(private cfg: NovaConfig) {}

  status() {
    const ready = Boolean(this.cfg.sandbox.url);
    return {
      kind: this.kind,
      ready,
      detail: ready
        ? `External sandbox at ${maskUrl(this.cfg.sandbox.url!)} (${this.cfg.sandbox.token ? 'authenticated' : 'NO AUTH TOKEN — do not expose publicly'}).`
        : 'NOVA_SANDBOX=http is set but NOVA_SANDBOX_URL is missing.',
      capabilities: ['shell commands', 'javascript', 'typescript', 'python', 'file mounts', 'build/test runners'],
      isolationNotes: [
        'Isolation is provided by the remote service, not by NOVA. Use a container or microVM.',
        'A reference implementation is included in scripts/sandbox-reference-server.mjs — run it INSIDE a disposable container.',
        'Free hosted options exist (e.g. Piston) but come with no SLA and their own rate limits; verify before relying on them.',
      ],
    };
  }

  async exec(req: SandboxExecRequest): Promise<SandboxExecResponse> {
    const url = this.cfg.sandbox.url;
    if (!url) {
      throw new HttpError(503, 'External sandbox URL is not configured.', 'sandbox_not_configured', 'Set NOVA_SANDBOX_URL (and NOVA_SANDBOX_TOKEN).');
    }
    const started = Date.now();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.sandbox.token) headers.authorization = `Bearer ${this.cfg.sandbox.token}`;
    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/$/, '')}/exec`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          command: req.command,
          code: req.code,
          language: req.language ?? 'javascript',
          files: req.files ?? {},
          projectId: req.projectId,
          timeoutMs: Math.min(req.timeoutMs ?? this.cfg.sandbox.timeoutMs, 120000),
        }),
        signal: AbortSignal.timeout(this.cfg.sandbox.timeoutMs + 10000),
      });
    } catch (err) {
      throw new HttpError(502, `Sandbox unreachable: ${err instanceof Error ? err.message : String(err)}`, 'sandbox_unreachable');
    }
    const text = await res.text();
    let json: Partial<SandboxExecResponse> & { error?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {
      throw new HttpError(502, `Sandbox returned non-JSON (HTTP ${res.status}): ${truncate(text, 300)}`, 'sandbox_error');
    }
    if (!res.ok) throw new HttpError(res.status, `Sandbox error: ${json.error ?? text.slice(0, 300)}`, 'sandbox_error');
    return {
      ok: Boolean(json.ok),
      stdout: truncate(String(json.stdout ?? ''), 20000),
      stderr: truncate(String(json.stderr ?? ''), 20000),
      exitCode: json.exitCode ?? null,
      durationMs: json.durationMs ?? Date.now() - started,
      truncated: Boolean(json.truncated),
      adapter: `http:${maskUrl(url)}`,
    };
  }
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}
