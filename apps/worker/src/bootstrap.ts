import { createApp } from './app.js';
import { ModelRouter } from './ai/router.js';
import { GitService } from './agent/git.js';
import { loadConfig, RuntimeSecrets, type RawEnv } from './env.js';
import { createLogger } from './lib/log.js';
import { createSandbox } from './sandbox/index.js';
import { D1BlobStore, FileBlobStore, MemoryBlobStore, R2BlobStore, type BlobStore } from './storage/blob.js';
import { D1Store } from './storage/d1-store.js';
import { JsonStore } from './storage/json-store.js';
import type { AppDeps } from './context.js';
import type { Store } from './storage/types.js';

export interface BootstrapOptions {
  env: RawEnv;
  /** Force a specific store (tests). Default: D1 when the binding exists. */
  store?: Store;
  blob?: BlobStore;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Test seam: inject provider adapters (bypasses env-based construction). */
  adapters?: import('./ai/types.js').ProviderAdapter[];
  /** Test seam: inject a sandbox adapter (bypasses env-based construction). */
  sandbox?: import('./sandbox/types.js').SandboxAdapter;
}

/**
 * Assemble the dependency graph once.
 * Order matters: config → store → blob → router → sandbox → app.
 */
export async function bootstrap(opts: BootstrapOptions): Promise<{ app: ReturnType<typeof createApp>; deps: AppDeps }> {
  const cfg = loadConfig(opts.env);
  const log = createLogger('nova', opts.logLevel ?? 'info');

  let store = opts.store;
  if (!store) {
    if (opts.env.DB) {
      store = new D1Store(opts.env.DB as never);
    } else if (cfg.runtime === 'node') {
      store = new JsonStore({ persistPath: `${cfg.dataDir}/nova-store.json` });
    } else {
      // Workers runtime without a D1 binding: fail loudly rather than silently
      // dropping data into memory that dies with the isolate.
      throw new Error('DB binding is missing. Declare d1_databases in wrangler.jsonc, or run the Node dev runtime (NOVA_RUNTIME=node).');
    }
  }
  await store.init();

  let blob = opts.blob;
  if (!blob) {
    if (opts.env.FILES) blob = new R2BlobStore(opts.env.FILES as never);
    else if (opts.env.DB) blob = new D1BlobStore(opts.env.DB as never);
    else if (cfg.runtime === 'node') blob = new FileBlobStore(`${cfg.dataDir}/blobs`);
    else blob = new MemoryBlobStore();
  }

  const secrets = new RuntimeSecrets();
  const router = new ModelRouter(opts.env, cfg, store, secrets, log.child('router'), opts.adapters);
  const sandbox = opts.sandbox ?? createSandbox(cfg, opts.env);
  const git = new GitService(store);

  /**
   * Probe the Workers AI binding once at startup.
   *
   * `ai.models()` is a catalog read: it runs no inference and spends no neurons,
   * but under `wrangler dev --local` it fails immediately. Detecting that here
   * marks the provider `needs-remote` BEFORE the first user request instead of
   * burning a request to discover it. Bounded by a timeout so boot never hangs.
   */
  if (cfg.runtime === 'workers' && opts.env.AI && !opts.adapters) {
    try {
      const probe = await Promise.race([
        router.probeWorkersAi(),
        new Promise<{ mode: string; detail: string }>((resolve) =>
          setTimeout(() => resolve({ mode: 'unknown', detail: 'probe timed out' }), 4000),
        ),
      ]);
      log.info('workers-ai probe', { mode: probe.mode });
      if (probe.mode !== 'remote') log.warn('Workers AI is not usable from this runtime', { detail: String(probe.detail).slice(0, 200) });
    } catch (err) {
      log.warn('workers-ai probe failed', { error: String(err) });
    }
  }

  const deps: AppDeps = { cfg, env: opts.env, store, blob, router, sandbox, secrets, log, git };
  const app = createApp(deps);

  log.info('bootstrap', {
    runtime: cfg.runtime,
    store: store.kind,
    blob: blob.kind,
    sandbox: sandbox.status().kind,
    providers: router.providerInfos().map((p) => `${p.id}:${p.status}`).join(', '),
  });
  return { app, deps };
}
