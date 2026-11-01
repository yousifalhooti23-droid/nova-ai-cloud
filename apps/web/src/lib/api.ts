/**
 * Typed HTTP client for the NOVA worker.
 *
 * Every call goes to a same-origin `/api/*` path (Vite proxies it in dev, the
 * Worker serves the built bundle in production), so no API key can ever end up
 * in browser code and no backend URL is configured client-side.
 */
import type {
  AdminPendingOtpSummary, AdminSecurityConfigResponse, AdminSecurityConfigUpdateRequest,
  AdminUsersResponse, AdminUserSummary, AgentRun, AgentRunDetailResponse, AgentRunRequest,
  ApplyAllResponse, AttachmentRef, AuthChangePasswordRequest, AuthGoogleRequest, AuthLoginRequest,
  AuthPublicConfigResponse, AuthRegisterRequest, AuthResendOtpRequest, AuthSessionResponse,
  AuthVerifyOtpRequest,
  ChangeActionRequest, ChatRequest, Commit, CommitRequest, Conversation, ConversationCreateRequest,
  ConversationPatchRequest, FileChange, FileResponse, FileWriteRequest, HealthResponse,
  LocalProviderKeysResponse, LocalProviderKeyUpdateRequest,
  MemoryCreateRequest, MemoryEntry, MemoryResponse, ModelClass, ModelsRefreshResponse,
  ModelsResponse, Project, ProjectCreateRequest, ProviderId, SandboxExecRequest,
  SandboxExecResponse, SandboxStatusResponse, SearchRequest, SearchResponse,
  SettingsResponse, SettingsUpdateRequest, Task, TaskCreateRequest, UsageResponse,
} from '@nova/shared';
import { Endpoints } from '@nova/shared';

const ACCESS_TOKEN_KEY = 'nova.access.token';
const SESSION_TOKEN_KEY = 'nova.session.token';

/**
 * In-memory token mirrors guarantee authentication keeps working on mobile
 * browsers where WebKit Private Browsing or Brave Shields ("Block All Cookies")
 * throw SecurityError/QuotaExceededError on localStorage writes.
 */
let memoryAccessToken = '';
let memorySessionToken = '';
let authExpiredHandler: (() => void) | null = null;

export function setAuthExpiredHandler(fn: (() => void) | null) {
  authExpiredHandler = fn;
}

export function notifyAuthExpired() {
  authExpiredHandler?.();
}

export function getStoredAccessToken(): string {
  if (memoryAccessToken) return memoryAccessToken;
  for (const store of [safeLocalStorage(), safeSessionStorage()]) {
    if (!store) continue;
    try {
      const val = store.getItem(ACCESS_TOKEN_KEY) ?? '';
      if (val) {
        memoryAccessToken = val;
        return val;
      }
    } catch {
      /* ignore storage errors */
    }
  }
  return '';
}

export function setStoredAccessToken(token: string) {
  const clean = token.trim();
  memoryAccessToken = clean;
  for (const store of [safeLocalStorage(), safeSessionStorage()]) {
    if (!store) continue;
    try {
      if (clean) store.setItem(ACCESS_TOKEN_KEY, clean);
      else store.removeItem(ACCESS_TOKEN_KEY);
    } catch {
      /* ignore storage errors */
    }
  }
}

export function getStoredSessionToken(): string {
  if (memorySessionToken) return memorySessionToken;
  for (const store of [safeLocalStorage(), safeSessionStorage()]) {
    if (!store) continue;
    try {
      const val = store.getItem(SESSION_TOKEN_KEY) ?? '';
      if (val) {
        memorySessionToken = val;
        return val;
      }
    } catch {
      /* ignore storage errors */
    }
  }
  return '';
}

export function setStoredSessionToken(token: string) {
  const clean = token.trim();
  memorySessionToken = clean;
  for (const store of [safeLocalStorage(), safeSessionStorage()]) {
    if (!store) continue;
    try {
      if (clean) store.setItem(SESSION_TOKEN_KEY, clean);
      else store.removeItem(SESSION_TOKEN_KEY);
    } catch {
      /* ignore storage errors */
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function getClientSessionId(): string {
  try {
    const storage = safeLocalStorage();
    let id = storage?.getItem('nova_client_session_id');
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      storage?.setItem('nova_client_session_id', id);
    }
    return id;
  } catch {
    return 'default_session';
  }
}

function authHeaders(extra?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (extra) {
    for (const [k, v] of Object.entries(extra as Record<string, string>)) out[k] = v;
  }
  const tok = getStoredAccessToken();
  if (tok) out['x-nova-token'] = tok;
  const sess = getStoredSessionToken();
  if (sess && !out.authorization && !out.Authorization) {
    out.authorization = `Bearer ${sess}`;
  }
  const sessionId = getClientSessionId();
  if (sessionId) out['x-session-id'] = sessionId;
  return out;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly hint?: string;
  readonly notConfigured?: boolean;
  readonly field?: string;

  constructor(status: number, body: { error?: string; code?: string; hint?: string; notConfigured?: boolean; field?: string }) {
    super(body.error ?? `Request failed (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.hint = body.hint;
    this.notConfigured = body.notConfigured;
    this.field = body.field;
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers: authHeaders(init?.headers) });
  } catch (err) {
    throw new ApiRequestError(0, {
      error: 'network',
      code: 'network_error',
      hint: err instanceof Error ? err.message : String(err),
    });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? safeJson(text) : {};
  if (!res.ok) {
    const errObj = body as Record<string, unknown>;
    if (res.status === 401 && errObj?.code === 'auth_required' && !path.startsWith('/api/auth/')) {
      notifyAuthExpired();
    }
    throw new ApiRequestError(res.status, errObj as never);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function json<T>(path: string, method: string, body?: unknown): Promise<T> {
  return http<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/* ------------------------------------------------------------- responses */

export interface GitStatusResponse {
  branch: string;
  head: { id: string; message: string; createdAt: string; author: string } | null;
  workingTree: { added: string[]; modified: string[]; deleted: string[]; clean: boolean };
  pendingProposals: { id: string; path: string; kind: FileChange['kind']; reason: string | null }[];
  fileCount: number;
}

export interface CommitShowResponse {
  commit: Commit;
  files: { path: string; patch: string; additions: number; deletions: number }[];
}

export interface PathDiffResponse {
  patch: string;
  additions: number;
  deletions: number;
  before: string;
  after: string;
}

export interface UploadResult extends AttachmentRef {
  extractedChars: number;
  warning?: string;
}

export interface ProbeResponse {
  mode: string;
  reachable?: boolean;
  detail?: string;
  models?: number;
  error?: string;
}

export interface ProviderKeysResponse {
  keys: { provider: ProviderId; masked: string; baseUrl?: string | null }[];
}

export const api = {
  /* ---- health, auth & models ---- */
  health: () => json<HealthResponse>(Endpoints.health, 'GET'),
  authConfig: () => json<AuthPublicConfigResponse>(Endpoints.authConfig, 'GET'),
  authMe: () => json<AuthSessionResponse>(Endpoints.authMe, 'GET'),
  authLogin: (body: AuthLoginRequest) => json<AuthSessionResponse>(Endpoints.authLogin, 'POST', body),
  authRegister: (body: AuthRegisterRequest) => json<AuthSessionResponse>(Endpoints.authRegister, 'POST', body),
  authVerifyOtp: (body: AuthVerifyOtpRequest) => json<AuthSessionResponse>(Endpoints.authVerifyOtp, 'POST', body),
  authResendOtp: (body: AuthResendOtpRequest) =>
    json<{ ok: boolean; expiresInSec: number; delivery: 'email' | 'pending_owner'; message: string }>(
      Endpoints.authResendOtp,
      'POST',
      body,
    ),
  authGoogle: (body: AuthGoogleRequest) => json<AuthSessionResponse>(Endpoints.authGoogle, 'POST', body),
  authLogout: () => json<{ ok: boolean }>(Endpoints.authLogout, 'POST', {}),
  authChangePassword: (body: AuthChangePasswordRequest) =>
    json<{ ok: boolean }>(Endpoints.authChangePassword, 'POST', body),
  adminUsers: () => json<AdminUsersResponse>(Endpoints.adminUsers, 'GET'),
  adminUserQuota: (id: string, body: { action: 'reset' | 'lock_week' | 'set_limit'; limit?: number }) =>
    json<{ user: AdminUserSummary }>(Endpoints.adminUserQuota(id), 'POST', body),
  adminGetSecurityConfig: () => json<AdminSecurityConfigResponse>(Endpoints.adminSecurityConfig, 'GET'),
  adminSaveSecurityConfig: (body: AdminSecurityConfigUpdateRequest) =>
    json<AdminSecurityConfigResponse>(Endpoints.adminSecurityConfig, 'PUT', body),
  adminTestOtp: (email?: string) =>
    json<{ ok: boolean; sentTo: string }>(Endpoints.adminTestOtp, 'POST', email ? { email } : {}),
  adminPendingOtps: () => json<{ pending: AdminPendingOtpSummary[] }>(Endpoints.adminPendingOtps, 'GET'),
  adminApprovePending: (email: string) =>
    json<{ user: AdminUserSummary }>(Endpoints.adminApprovePending, 'POST', { email }),
  models: () => json<ModelsResponse>(Endpoints.models, 'GET'),
  refreshModels: (provider?: ProviderId) =>
    json<ModelsRefreshResponse[]>(Endpoints.modelsRefresh, 'POST', provider ? { provider } : {}),
  probeWorkersAi: () => json<ProbeResponse>(`${Endpoints.models}/workers-ai-probe`, 'GET'),
  probeProvider: (provider: ProviderId, modelId?: string) =>
    json<ProbeResponse>(`${Endpoints.models}/probe`, 'POST', { provider, modelId }),

  /* ---- conversations ---- */
  listConversations: (projectId?: string | null) =>
    json<{ conversations: Conversation[] }>(
      projectId ? `${Endpoints.conversations}?projectId=${encodeURIComponent(projectId)}` : Endpoints.conversations,
      'GET',
    ),
  createConversation: (body: ConversationCreateRequest) =>
    json<{ conversation: Conversation }>(Endpoints.conversations, 'POST', body),
  getConversation: (id: string) => json<{ conversation: Conversation }>(Endpoints.conversation(id), 'GET'),
  patchConversation: (id: string, body: ConversationPatchRequest) =>
    json<{ conversation: Conversation }>(Endpoints.conversation(id), 'PATCH', body),
  deleteConversation: (id: string) => json<{ ok: boolean }>(Endpoints.conversation(id), 'DELETE'),
  messages: (id: string) =>
    json<{ messages: import('@nova/shared').ChatMessage[] }>(Endpoints.conversationMessages(id), 'GET'),

  /* ---- uploads ---- */
  async upload(file: File, projectId?: string | null): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', file);
    if (projectId) form.append('projectId', projectId);
    const res = await http<{ attachment: AttachmentRef; extractedChars: number; warning?: string }>(
      Endpoints.uploads,
      { method: 'POST', body: form },
    );
    return { ...res.attachment, extractedChars: res.extractedChars, warning: res.warning };
  },

  /* ---- chat (streaming handled by lib/sse.ts) ---- */
  chatBody(body: ChatRequest): { url: string; init: RequestInit } {
    return {
      url: Endpoints.chat,
      init: { method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(body) },
    };
  },

  /* ---- projects & files ---- */
  listProjects: () => json<{ projects: Project[] }>(Endpoints.projects, 'GET'),
  createProject: (body: ProjectCreateRequest) => json<{ project: Project }>(Endpoints.projects, 'POST', body),
  getProject: (id: string) => json<{ project: Project }>(Endpoints.project(id), 'GET'),
  patchProject: (id: string, body: Partial<ProjectCreateRequest>) =>
    json<{ project: Project }>(Endpoints.project(id), 'PATCH', body),
  deleteProject: (id: string) => json<{ ok: boolean }>(Endpoints.project(id), 'DELETE'),
  listFiles: (id: string) =>
    json<{ files: { path: string; sizeBytes: number; sha: string; language: string; updatedAt: string }[] }>(
      Endpoints.projectFiles(id),
      'GET',
    ),
  readFile: (id: string, path: string) =>
    json<FileResponse & { language: string }>(
      `${Endpoints.projectFile(id)}?path=${encodeURIComponent(path)}`,
      'GET',
    ),
  writeFile: (id: string, body: FileWriteRequest) =>
    json<{ file: import('@nova/shared').ProjectFile; commitId: string | null }>(
      Endpoints.projectFile(id),
      'PUT',
      body,
    ),
  deleteFile: (id: string, path: string) =>
    json<{ ok: boolean; path: string }>(`${Endpoints.projectFile(id)}?path=${encodeURIComponent(path)}`, 'DELETE'),
  search: (id: string, body: SearchRequest) =>
    json<SearchResponse>(Endpoints.projectSearch(id), 'POST', body),

  /* ---- changes (approval flow) ---- */
  listChanges: (id: string, status?: 'pending' | 'applied' | 'rejected') =>
    json<{ changes: (FileChange & { additions: number; deletions: number })[] }>(
      status ? `${Endpoints.projectChanges(id)}?status=${status}` : Endpoints.projectChanges(id),
      'GET',
    ),
  actOnChange: (changeId: string, body: ChangeActionRequest) =>
    json<{ change: FileChange; diff?: string }>(Endpoints.changeAction(changeId), 'POST', body),
  applyAll: (id: string, body?: { action?: 'apply' | 'reject'; commitMessage?: string }) =>
    json<ApplyAllResponse>(`${Endpoints.projectChanges(id)}/apply-all`, 'POST', body ?? { action: 'apply' }),

  /* ---- git ---- */
  gitStatus: (id: string) => json<GitStatusResponse>(`${Endpoints.project(id)}/git/status`, 'GET'),
  commits: (id: string, limit = 50) =>
    json<{ commits: Commit[] }>(`${Endpoints.projectCommits(id)}?limit=${limit}`, 'GET'),
  commit: (id: string, body: CommitRequest) =>
    json<{ commit: Commit }>(Endpoints.projectCommit(id, ''), 'POST', body),
  showCommit: (id: string, commitId: string) =>
    json<CommitShowResponse>(Endpoints.projectCommit(id, commitId), 'GET'),
  diffPath: (id: string, path: string) =>
    json<PathDiffResponse>(`${Endpoints.project(id)}/diff?path=${encodeURIComponent(path)}`, 'GET'),
  pushGithub: (id: string, body?: { message?: string }) =>
    json<{ ok: boolean; configured?: boolean; detail?: string; hint?: string; pushed?: number; skipped?: number; commitUrl?: string; errors?: { path: string; error: string }[] }>(
      `${Endpoints.project(id)}/git/push`,
      'POST',
      body ?? {},
    ),

  /* ---- agent ---- */
  agentBody(body: AgentRunRequest): { url: string; init: RequestInit } {
    return {
      url: Endpoints.agentRun,
      init: { method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(body) },
    };
  },
  listRuns: (projectId?: string | null) =>
    json<{ runs: AgentRun[] }>(
      projectId ? `${Endpoints.agentRuns}?projectId=${encodeURIComponent(projectId)}` : Endpoints.agentRuns,
      'GET',
    ),
  runDetail: (id: string) => json<AgentRunDetailResponse>(Endpoints.agentRunDetail(id), 'GET'),

  /* ---- sandbox ---- */
  sandboxStatus: () => json<SandboxStatusResponse>(Endpoints.sandboxStatus, 'GET'),
  sandboxExec: (body: SandboxExecRequest) => json<SandboxExecResponse>(Endpoints.sandboxExec, 'POST', body),

  /* ---- tasks / memory / usage / settings ---- */
  listTasks: (projectId?: string | null, runId?: string | null) => {
    const q = new URLSearchParams();
    if (projectId) q.set('projectId', projectId);
    if (runId) q.set('runId', runId);
    const qs = q.toString();
    return json<{ tasks: Task[] }>(qs ? `${Endpoints.tasks}?${qs}` : Endpoints.tasks, 'GET');
  },
  createTask: (body: TaskCreateRequest) => json<{ task: Task }>(Endpoints.tasks, 'POST', body),
  patchTask: (id: string, body: Partial<Pick<Task, 'title' | 'detail' | 'status'>>) =>
    json<{ task: Task }>(Endpoints.task(id), 'PATCH', body),
  deleteTask: (id: string) => json<{ ok: boolean }>(Endpoints.task(id), 'DELETE'),

  listMemory: (scope?: 'global' | 'project', scopeId?: string | null) => {
    const q = new URLSearchParams();
    if (scope) q.set('scope', scope);
    if (scopeId) q.set('scopeId', scopeId);
    const qs = q.toString();
    return json<MemoryResponse>(qs ? `${Endpoints.memory}?${qs}` : Endpoints.memory, 'GET');
  },
  createMemory: (body: MemoryCreateRequest) => json<{ entry: MemoryEntry }>(Endpoints.memory, 'POST', body),
  deleteMemory: (id: string) => json<{ ok: boolean }>(Endpoints.memoryEntry(id), 'DELETE'),

  usage: (limit = 100) => json<UsageResponse>(`${Endpoints.usage}?limit=${limit}`, 'GET'),
  getSettings: () => json<SettingsResponse>(Endpoints.settings, 'GET'),
  updateSettings: (body: SettingsUpdateRequest) => json<SettingsResponse>(Endpoints.settings, 'PUT', body),
  getLocalProviderKeys: () => json<LocalProviderKeysResponse>(Endpoints.localProviderKeys, 'GET'),
  saveLocalProviderKey: (body: LocalProviderKeyUpdateRequest) =>
    json<{ ok: boolean; provider: ProviderId; masked?: string; baseUrl?: string; removed?: boolean; persisted?: boolean }>(
      Endpoints.localProviderKeys,
      'POST',
      body,
    ),
};

/** Narrow an unknown error into something the UI can render. */
export function describeApiError(err: unknown): { message: string; code?: string; hint?: string; notConfigured?: boolean } {
  if (err instanceof ApiRequestError) {
    return { message: err.message, code: err.code, hint: err.hint, notConfigured: err.notConfigured };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

export type { ModelClass };
