import type { NovaConfig, RawEnv } from '../env.js';
import { DisabledSandbox } from './disabled.js';
import { HttpSandbox } from './http.js';
import { WorkerIsolateSandbox } from './worker-isolate.js';
import type { SandboxAdapter } from './types.js';

/** Pick the sandbox adapter from config. Defaults to disabled (fail closed). */
export function createSandbox(cfg: NovaConfig, env: RawEnv): SandboxAdapter {
  switch (cfg.sandbox.kind) {
    case 'worker-isolate':
      return new WorkerIsolateSandbox(env.SANDBOX as never, cfg);
    case 'http':
      return new HttpSandbox(cfg);
    default:
      return new DisabledSandbox();
  }
}

export * from './types.js';
