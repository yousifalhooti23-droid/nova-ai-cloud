import type { ModelClass, ProviderId } from '@nova/shared';

/** Raw environment shape (Workers bindings + plain vars, or process.env under Node). */
export interface RawEnv {
  DB?: unknown;
  FILES?: unknown;
  AI?: unknown;
  SANDBOX?: { fetch(req: Request | string, init?: RequestInit): Promise<Response> };
  ASSETS?: { fetch(req: Request | string): Promise<Response> };
  [key: string]: unknown;
}

export interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  /** Restrict which upstream ids this provider may serve. */
  allowedModels?: string[];
  /** Why it is disabled / what is missing. Shown verbatim in the UI. */
  missing?: string;
}

export interface SandboxConfig {
  kind: 'disabled' | 'worker-isolate' | 'http';
  url?: string;
  token?: string;
  timeoutMs: number;
}

export interface NovaConfig {
  runtime: 'workers' | 'node';
  version: string;
  providerPriority: ProviderId[];
  providers: Record<ProviderId, ProviderConfig>;
  classOverrides: Partial<Record<ModelClass, string>>;
  diagnosticEnabled: boolean;
  allowRuntimeKeys: boolean;
  adminToken?: string;
  /** Optional shared secret protecting /api/* on public cloud deployments. */
  accessToken?: string;
  /** Writable env file path in local/desktop Node mode for UI key persistence. */
  envFilePath?: string;
  sandbox: SandboxConfig;
  allowedOrigins: string[];
  maxUploadBytes: number;
  dataDir: string;
}

function read(env: RawEnv, key: string): string | undefined {
  const v = env[key];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * Build a typed, validated config. This is the single place that knows about
 * environment variable names — the rest of the app receives NovaConfig.
 *
 * Secrets stay here. Nothing from this object is ever serialised to a response;
 * `providerStatus()` derives a redacted view for the UI.
 */
export function loadConfig(env: RawEnv): NovaConfig {
  const runtime = read(env, 'NOVA_RUNTIME') === 'node' ? 'node' : 'workers';
  const priorityRaw = list(read(env, 'NOVA_PROVIDER_PRIORITY'), ['workers-ai', 'openrouter', 'custom']);
  const providerPriority = priorityRaw as ProviderId[];

  const hasAiBinding = Boolean(env.AI);
  const workersAiMissing = hasAiBinding
    ? undefined
    : runtime === 'node'
      ? 'Workers AI is only available inside the Cloudflare Workers runtime (no AI binding under Node).'
      : 'The AI binding is not declared. Add `"ai": { "binding": "AI" }` to wrangler.jsonc.';

  const customBase = read(env, 'NOVA_CUSTOM_BASE_URL');
  const customKey = read(env, 'NOVA_CUSTOM_API_KEY');

  const providers: Record<ProviderId, ProviderConfig> = {
    'workers-ai': {
      id: 'workers-ai',
      enabled: hasAiBinding,
      missing: workersAiMissing,
    },
    openrouter: {
      id: 'openrouter',
      enabled: Boolean(read(env, 'OPENROUTER_API_KEY')),
      apiKey: read(env, 'OPENROUTER_API_KEY'),
      baseUrl: read(env, 'OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1',
      missing: read(env, 'OPENROUTER_API_KEY') ? undefined : 'OPENROUTER_API_KEY is not set.',
    },
    groq: {
      id: 'groq',
      enabled: Boolean(read(env, 'GROQ_API_KEY')),
      apiKey: read(env, 'GROQ_API_KEY'),
      baseUrl: read(env, 'GROQ_BASE_URL') ?? 'https://api.groq.com/openai/v1',
      missing: read(env, 'GROQ_API_KEY') ? undefined : 'GROQ_API_KEY is not set.',
    },
    custom: {
      id: 'custom',
      enabled: Boolean(customBase),
      apiKey: customKey,
      baseUrl: customBase,
      allowedModels: list(read(env, 'NOVA_CUSTOM_MODELS'), []),
      missing: customBase ? undefined : 'NOVA_CUSTOM_BASE_URL is not set.',
    },
    diagnostic: {
      id: 'diagnostic',
      enabled: bool(read(env, 'NOVA_ENABLE_DIAGNOSTIC'), false),
      missing: bool(read(env, 'NOVA_ENABLE_DIAGNOSTIC'), false)
        ? undefined
        : 'Set NOVA_ENABLE_DIAGNOSTIC=true to enable. This is an echo provider for plumbing tests, not an AI model.',
    },
  };

  const sandboxKindRaw = (read(env, 'NOVA_SANDBOX') ?? 'disabled').toLowerCase();
  const sandboxKind = sandboxKindRaw === 'worker' || sandboxKindRaw === 'worker-isolate'
    ? 'worker-isolate'
    : sandboxKindRaw === 'http'
      ? 'http'
      : 'disabled';

  return {
    runtime,
    version: read(env, 'NOVA_VERSION') ?? '0.1.0',
    providerPriority,
    providers,
    classOverrides: {
      chat: read(env, 'NOVA_MODEL_CHAT'),
      reasoning: read(env, 'NOVA_MODEL_REASONING'),
      coding: read(env, 'NOVA_MODEL_CODING'),
      'long-context': read(env, 'NOVA_MODEL_LONG_CONTEXT'),
    },
    diagnosticEnabled: providers.diagnostic.enabled,
    allowRuntimeKeys: bool(read(env, 'NOVA_ALLOW_RUNTIME_KEYS'), false),
    adminToken: read(env, 'NOVA_ADMIN_TOKEN'),
    accessToken: read(env, 'NOVA_ACCESS_TOKEN'),
    envFilePath: read(env, 'NOVA_ENV_FILE'),
    sandbox: {
      kind: sandboxKind,
      url: read(env, 'NOVA_SANDBOX_URL'),
      token: read(env, 'NOVA_SANDBOX_TOKEN'),
      timeoutMs: Number(read(env, 'NOVA_SANDBOX_TIMEOUT_MS') ?? 20000),
    },
    allowedOrigins: list(read(env, 'NOVA_ALLOWED_ORIGINS'), []),
    maxUploadBytes: Number(read(env, 'NOVA_MAX_UPLOAD_BYTES') ?? 25 * 1024 * 1024),
    dataDir: read(env, 'NOVA_DATA_DIR') ?? './.nova-data',
  };
}

/**
 * Memory-only key store for `NOVA_ALLOW_RUNTIME_KEYS`.
 * Keys live in the isolate/request context, are never written to D1/R2, and are
 * never returned by any endpoint. Restarting the Worker clears them.
 */
export class RuntimeSecrets {
  private map = new Map<ProviderId, { apiKey?: string; baseUrl?: string }>();
  private removed = new Set<ProviderId>();
  set(provider: ProviderId, apiKey?: string, baseUrl?: string) {
    this.removed.delete(provider);
    this.map.set(provider, { apiKey, baseUrl });
  }
  get(provider: ProviderId) {
    return this.map.get(provider);
  }
  isRemoved(provider: ProviderId) {
    return this.removed.has(provider);
  }
  delete(provider: ProviderId) {
    this.map.delete(provider);
    this.removed.add(provider);
  }
  list(): { provider: ProviderId; masked: string; baseUrl?: string }[] {
    return [...this.map.entries()]
      .filter(([, v]) => Boolean(v.apiKey || v.baseUrl))
      .map(([provider, v]) => ({ provider, masked: v.apiKey ? maskSecret(v.apiKey) : '', baseUrl: v.baseUrl }));
  }
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Merge runtime-injected keys over the static config (supports live updates & removals). */
export function withRuntimeSecrets(cfg: NovaConfig, secrets: RuntimeSecrets): NovaConfig {
  const providers = { ...cfg.providers };
  for (const id of Object.keys(providers) as ProviderId[]) {
    if (secrets.isRemoved(id)) {
      providers[id] = {
        ...providers[id],
        apiKey: undefined,
        baseUrl: id === 'custom' ? undefined : providers[id].baseUrl,
        enabled: id === 'workers-ai' ? providers[id].enabled : false,
        missing: id === 'custom' ? 'NOVA_CUSTOM_BASE_URL is not set.' : `${id.toUpperCase()}_API_KEY is not set.`,
      };
      continue;
    }
    const injected = secrets.get(id);
    if (!injected) continue;
    const nextKey = injected.apiKey ?? providers[id].apiKey;
    const nextBase = injected.baseUrl ?? providers[id].baseUrl;
    const enabled = id === 'workers-ai' ? providers[id].enabled : id === 'custom' ? Boolean(nextBase) : Boolean(nextKey);
    providers[id] = {
      ...providers[id],
      apiKey: nextKey,
      baseUrl: nextBase,
      enabled,
      missing: enabled ? undefined : providers[id].missing,
    };
  }
  return { ...cfg, providers };
}
