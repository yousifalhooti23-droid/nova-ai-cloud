/**
 * Typed HTTP client for the NOVA worker.
 *
 * Every call goes to a same-origin `/api/*` path (Vite proxies it in dev, the
 * Worker serves the built bundle in production), so no API key can ever end up
 * in browser code and no backend URL is configured client-side.
 */
import type {
  AgentRun, AgentRunDetailResponse, AgentRunRequest, ApplyAllResponse, AttachmentRef,
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

export function getStoredAccessToken(): string {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setStoredAccessToken(token: string) {
  try {
    const clean = token.trim();
    if (clean) localStorage.setItem(ACCESS_TOKEN_KEY, clean);
    else localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
}

function authHeaders(extra?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (extra) {
    for (const [k, v] of Object.entries(extra as Record<string, string>)) out[k] = v;
  }
  const tok = getStoredAccessToken();
  if (tok) out['x-nova-token'] = tok;
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
    res = await fetch(path, { ...init, headers: authHeaders(init?.headers) });
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
  if (!res.ok) throw new ApiRequestError(res.status, body as Record<string, unknown> as never);
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
  /* ---- health & models ---- */
  health: () => json<HealthResponse>(Endpoints.health, 'GET'),
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
