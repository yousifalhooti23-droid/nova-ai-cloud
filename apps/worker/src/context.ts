import type { Hono } from 'hono';
import type { NovaConfig, RawEnv, RuntimeSecrets } from './env.js';
import type { ModelRouter } from './ai/router.js';
import type { SandboxAdapter } from './sandbox/types.js';
import type { Store } from './storage/types.js';
import type { BlobStore } from './storage/blob.js';
import type { Logger } from './lib/log.js';
import { GitService } from './agent/git.js';

/** Everything a route handler needs, assembled once per request context. */
export interface AppDeps {
  cfg: NovaConfig;
  env: RawEnv;
  store: Store;
  blob: BlobStore;
  router: ModelRouter;
  sandbox: SandboxAdapter;
  secrets: RuntimeSecrets;
  log: Logger;
  git: GitService;
}

export type AppEnv = { Variables: { deps: AppDeps; requestId: string; startedAt: number } };
export type App = Hono<AppEnv>;

export function deps(c: { get(key: 'deps'): AppDeps }): AppDeps {
  return c.get('deps');
}
