import { createApp } from './app.js';
import { ModelRouter } from './ai/router.js';
import { GitService } from './agent/git.js';
import { loadConfig, RuntimeSecrets, type RawEnv } from './env.js';
import { createLogger } from './lib/log.js';
import { createSandbox } from './sandbox/index.js';
import { D1BlobStore, FileBlobStore, MemoryBlobStore, R2BlobStore, type BlobStore } from './storage/blob.js';
import { D1Store } from './storage/d1-store.js';
import { JsonStore } from './storage/json-store.js';
import { D1AuthRepo, JsonAuthRepo, type AuthRepo } from './auth/repo.js';
import { AuthService } from './auth/service.js';
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

  // Allow Node / Desktop sidecar to use Cloudflare Workers AI cloud GPUs remotely when credentials are present.
  const cfToken = typeof opts.env.CLOUDFLARE_API_TOKEN === 'string' ? opts.env.CLOUDFLARE_API_TOKEN.trim() : '';
  const cfAccount = typeof opts.env.CLOUDFLARE_ACCOUNT_ID === 'string' ? opts.env.CLOUDFLARE_ACCOUNT_ID.trim() : '';
  if (!opts.env.AI && cfToken && cfAccount) {
    opts.env = {
      ...opts.env,
      AI: createRemoteCloudflareAiBinding(cfAccount, cfToken),
    };
  }

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

  const authRepo: AuthRepo = opts.env.DB
    ? new D1AuthRepo(opts.env.DB as never)
    : new JsonAuthRepo(cfg.runtime === 'node' && !opts.store ? `${cfg.dataDir}/nova-auth.json` : undefined);
  await authRepo.init();
  const auth = new AuthService(authRepo, {
    defaultDailyQuota: cfg.userDailyQuotaLimit,
    ownerEmail: cfg.ownerEmail,
    ownerInitialPassword: cfg.ownerInitialPassword,
    ownerDisplayName: cfg.ownerDisplayName,
  });
  await auth.bootstrapOwner(store);

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

  const deps: AppDeps = { cfg, env: opts.env, store, blob, router, sandbox, secrets, log, git, auth };
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

function createRemoteCloudflareAiBinding(accountId: string, apiToken: string) {
  return {
    isRemoteRest: true,
    async run(model: string, params: Record<string, unknown>): Promise<unknown> {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }
      if (params.stream === true && resp.body) {
        return resp.body;
      }
      const ct = (resp.headers.get('content-type') ?? '').toLowerCase();
      if (ct.startsWith('image/') || ct.includes('octet-stream')) {
        return new Uint8Array(await resp.arrayBuffer());
      }
      const json = (await resp.json()) as { result?: unknown };
      return json?.result ?? json;
    },
  };
}
