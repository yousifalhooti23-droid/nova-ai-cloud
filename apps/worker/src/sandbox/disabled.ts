import type { SandboxExecRequest, SandboxExecResponse, SandboxStatusResponse } from '@nova/shared';
import { HttpError } from '../lib/errors.js';
import type { SandboxAdapter } from './types.js';

/** Default adapter: refuses to execute and explains exactly how to enable a real sandbox. */
export class DisabledSandbox implements SandboxAdapter {
  readonly kind = 'disabled' as const;

  status(): SandboxStatusResponse {
    return {
      kind: 'disabled',
      ready: false,
      detail: 'No sandbox is configured. Terminal and code-execution tools are disabled by design.',
      capabilities: [],
      isolationNotes: [
        'The API Worker holds D1, R2 and provider keys — user code must never run inside it.',
        'Set NOVA_SANDBOX=worker to use the isolated sandbox Worker (JavaScript only, no fs/net/secrets).',
        'Set NOVA_SANDBOX=http plus NOVA_SANDBOX_URL to use an external sandbox service that provides a real shell.',
      ],
    };
  }

  async exec(_req: SandboxExecRequest): Promise<SandboxExecResponse> {
    throw new HttpError(
      503,
      'Sandbox is not configured — command execution is disabled.',
      'sandbox_not_configured',
      'Set NOVA_SANDBOX=worker (isolated Worker, JS only) or NOVA_SANDBOX=http + NOVA_SANDBOX_URL (real shell in a container). See docs/SANDBOX.md.',
    );
  }
}
