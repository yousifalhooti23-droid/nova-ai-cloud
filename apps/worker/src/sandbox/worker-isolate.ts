import type { SandboxExecRequest, SandboxExecResponse } from '@nova/shared';
import { HttpError } from '../lib/errors.js';
import type { NovaConfig } from '../env.js';
import type { SandboxAdapter } from './types.js';

interface ServiceBinding {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

/**
 * Isolated sandbox Worker adapter (service binding).
 *
 * Isolation properties — stated plainly, no overclaiming:
 *   + Separate Worker script with NO bindings: no D1, no R2, no AI, no secrets.
 *   + Separate deployment, separate memory space; it cannot read the API env.
 *   + Hard CPU/time budget enforced by the Workers platform.
 *   - It is still V8-on-workerd, not a container: no POSIX shell, no filesystem,
 *     no process spawning. It executes JavaScript only.
 * For a real shell (`npm test`, `git status`, compilers) use the `http` adapter
 * pointed at a containerised sandbox service.
 */
export class WorkerIsolateSandbox implements SandboxAdapter {
  readonly kind = 'worker-isolate' as const;

  constructor(private binding: ServiceBinding | undefined, private cfg: NovaConfig) {}

  status() {
    const ready = Boolean(this.binding);
    return {
      kind: this.kind,
      ready,
      detail: ready
        ? 'Isolated sandbox Worker bound (service binding SANDBOX). JavaScript only — no shell, no filesystem, no network, no secrets.'
        : 'NOVA_SANDBOX=worker is set but the SANDBOX service binding is missing. Deploy sandbox/ and add the service binding (see wrangler.jsonc).',
      capabilities: ['javascript', 'typescript-transpile-free', 'console capture', 'deterministic output'],
      isolationNotes: [
        'Runs in a separate Worker with zero bindings, so it cannot reach D1, R2, AI or any secret.',
        'Not a container: no POSIX shell, no fs, no child processes, no outbound network by default.',
        'For real builds/tests use NOVA_SANDBOX=http with a containerised sandbox service.',
      ],
    };
  }

  async exec(req: SandboxExecRequest): Promise<SandboxExecResponse> {
    if (!this.binding) {
      throw new HttpError(503, 'Sandbox Worker binding is not available.', 'sandbox_not_configured', 'Deploy the sandbox Worker (sandbox/) and reference it as a service binding named SANDBOX.');
    }
    if (req.command && !req.code) {
      throw new HttpError(
        400,
        'The isolated Worker sandbox cannot run shell commands.',
        'sandbox_no_shell',
        'It executes JavaScript only. Set NOVA_SANDBOX=http + NOVA_SANDBOX_URL to reach a sandbox that provides a real shell (e.g. a container running the reference server in scripts/sandbox-reference-server.mjs).',
      );
    }
    const started = Date.now();
    const res = await this.binding.fetch('https://nova-sandbox/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: req.code ?? '',
        language: req.language ?? 'javascript',
        files: req.files ?? {},
        timeoutMs: Math.min(req.timeoutMs ?? this.cfg.sandbox.timeoutMs, 30000),
      }),
      signal: AbortSignal.timeout(this.cfg.sandbox.timeoutMs + 5000),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<SandboxExecResponse> & { error?: string };
    if (!res.ok) {
      throw new HttpError(res.status, `Sandbox Worker error: ${json.error ?? res.statusText}`, 'sandbox_error');
    }
    return {
      ok: Boolean(json.ok),
      stdout: String(json.stdout ?? ''),
      stderr: String(json.stderr ?? ''),
      exitCode: json.exitCode ?? null,
      durationMs: json.durationMs ?? Date.now() - started,
      truncated: Boolean(json.truncated),
      adapter: 'worker-isolate',
    };
  }
}
