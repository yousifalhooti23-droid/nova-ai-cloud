import type { SandboxExecRequest, SandboxExecResponse, SandboxStatusResponse } from '@nova/shared';

/**
 * Code execution MUST NOT happen inside the API Worker.
 *
 * The API Worker holds D1, R2 and provider API keys. Running user code there
 * would mean one bad `run_command` could read secrets. So execution is delegated
 * to an adapter, and the default adapter is *disabled* — the tool then returns
 * an explicit "not configured" error instead of pretending to run something.
 */
export interface SandboxAdapter {
  readonly kind: SandboxStatusResponse['kind'];
  status(): SandboxStatusResponse;
  exec(req: SandboxExecRequest): Promise<SandboxExecResponse>;
}

export type { SandboxExecRequest, SandboxExecResponse };
