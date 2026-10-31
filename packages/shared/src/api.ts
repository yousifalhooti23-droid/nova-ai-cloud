/**
 * The HTTP contract between the web app and the worker.
 * Both sides import these types, so a change here breaks the build instead of
 * breaking at runtime.
 */
import type {
  AgentRun, AttachmentRef, ChangeStatus, Commit, Conversation, FileChange, ISODate,
  MemoryEntry, MemoryScope, ModelClass, ModelInfo, Project, ProjectFile, ProviderInfo,
  ProviderId, Task, UsageRecord,
} from './types.js';

export const API_PREFIX = '/api';

export const Endpoints = {
  health: `${API_PREFIX}/health`,
  models: `${API_PREFIX}/models`,
  modelsRefresh: `${API_PREFIX}/models/refresh`,
  chat: `${API_PREFIX}/chat`,
  conversations: `${API_PREFIX}/conversations`,
  conversation: (id: string) => `${API_PREFIX}/conversations/${id}`,
  conversationMessages: (id: string) => `${API_PREFIX}/conversations/${id}/messages`,
  uploads: `${API_PREFIX}/uploads`,
  projects: `${API_PREFIX}/projects`,
  project: (id: string) => `${API_PREFIX}/projects/${id}`,
  projectFiles: (id: string) => `${API_PREFIX}/projects/${id}/files`,
  projectFile: (id: string) => `${API_PREFIX}/projects/${id}/file`,
  projectChanges: (id: string) => `${API_PREFIX}/projects/${id}/changes`,
  changeAction: (changeId: string) => `${API_PREFIX}/changes/${changeId}`,
  projectCommits: (id: string) => `${API_PREFIX}/projects/${id}/commits`,
  projectCommit: (id: string, commitId: string) => `${API_PREFIX}/projects/${id}/commits/${commitId}`,
  projectSearch: (id: string) => `${API_PREFIX}/projects/${id}/search`,
  agentRun: `${API_PREFIX}/agent/run`,
  agentRuns: `${API_PREFIX}/agent/runs`,
  agentRunDetail: (id: string) => `${API_PREFIX}/agent/runs/${id}`,
  sandboxExec: `${API_PREFIX}/sandbox/exec`,
  sandboxStatus: `${API_PREFIX}/sandbox/status`,
  tasks: `${API_PREFIX}/tasks`,
  task: (id: string) => `${API_PREFIX}/tasks/${id}`,
  memory: `${API_PREFIX}/memory`,
  memoryEntry: (id: string) => `${API_PREFIX}/memory/${id}`,
  usage: `${API_PREFIX}/usage`,
  settings: `${API_PREFIX}/settings`,
  localProviderKeys: `${API_PREFIX}/settings/provider-keys`,
  providerKeys: `${API_PREFIX}/admin/provider-keys`,
} as const;

/* --------------------------------------------------------------- health */

export interface HealthResponse {
  ok: boolean;
  version: string;
  runtime: 'workers' | 'node';
  authProtected?: boolean;
  store: { kind: 'd1' | 'json'; ready: boolean; detail: string };
  blob: { kind: 'r2' | 'file' | 'memory'; ready: boolean };
  sandbox: { kind: string; ready: boolean; detail: string };
  providers: ProviderInfo[];
  time: ISODate;
}

/* --------------------------------------------------------------- models */

export interface ModelsResponse {
  models: ModelInfo[];
  providers: ProviderInfo[];
  defaults: Record<ModelClass, string | null>;
  catalogVerifiedAt: string;
  notes: string[];
}

export interface ModelsRefreshResponse {
  provider: ProviderId;
  fetchedAt: ISODate;
  added: number;
  updated: number;
  total: number;
  models: ModelInfo[];
  error?: string;
}

/* ----------------------------------------------------------------- chat */

export interface ChatRequest {
  conversationId?: string;
  projectId?: string | null;
  message: string;
  modelId?: string | null;
  modelClass?: ModelClass;
  attachments?: AttachmentRef[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  /** Ask the router for a tool-calling model and expose the tool list. */
  enableTools?: boolean;
}

export interface ConversationCreateRequest {
  title?: string;
  projectId?: string | null;
  modelId?: string | null;
  modelClass?: ModelClass;
  memoryEnabled?: boolean;
}

export interface ConversationPatchRequest {
  title?: string;
  modelId?: string | null;
  modelClass?: ModelClass;
  projectId?: string | null;
  memoryEnabled?: boolean;
  archived?: boolean;
}

export interface ConversationListResponse {
  conversations: Conversation[];
}

export interface MessagesResponse {
  messages: (import('./types.js').ChatMessage)[];
}

export interface UploadResponse {
  attachment: AttachmentRef;
  extractedChars: number;
  warning?: string;
}

/* ------------------------------------------------------------- projects */

export interface ProjectCreateRequest {
  name: string;
  description?: string;
  language?: string;
  /** Seed files created with the project (path -> content). */
  files?: Record<string, string>;
}

export interface ProjectListResponse {
  projects: Project[];
}

export interface FileWriteRequest {
  path: string;
  content: string;
  /** Optional optimistic concurrency: refuse if the file changed since. */
  expectedSha?: string | null;
  commitMessage?: string;
}

export interface FileResponse {
  file: ProjectFile;
}

export interface FileListResponse {
  files: Pick<ProjectFile, 'path' | 'sizeBytes' | 'sha' | 'language' | 'updatedAt'>[];
}

export interface ChangesResponse {
  changes: (FileChange & { additions: number; deletions: number })[];
}

export interface ChangeActionRequest {
  action: 'apply' | 'reject';
}

export interface ApplyAllResponse {
  applied: number;
  rejected: number;
  commitId: string | null;
}

export interface CommitsResponse {
  commits: Commit[];
}

export interface CommitRequest {
  message: string;
  author?: string;
}

export interface SearchRequest {
  query: string;
  /** file-name match, content match, or both */
  mode?: 'name' | 'content' | 'all';
  caseSensitive?: boolean;
  regex?: boolean;
  limit?: number;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
  score: number;
}

export interface SearchResponse {
  hits: SearchHit[];
  scannedFiles: number;
  truncated: boolean;
}

/* ---------------------------------------------------------------- agent */

export interface AgentRunRequest {
  projectId: string;
  conversationId?: string | null;
  prompt: string;
  modelId?: string | null;
  modelClass?: ModelClass;
  maxSteps?: number;
  /** When false (default) file writes are proposed and wait for approval. */
  autoApply?: boolean;
  /** Allow the agent to execute commands in the configured sandbox. */
  allowTerminal?: boolean;
}

export interface AgentRunsResponse {
  runs: AgentRun[];
}

export interface AgentRunDetailResponse {
  run: AgentRun;
  events: { seq: number; type: string; payload: unknown; createdAt: ISODate }[];
  changes: FileChange[];
  tasks: Task[];
}

export interface ApprovalDecision {
  approved: boolean;
  note?: string;
}

/* -------------------------------------------------------------- sandbox */

export interface SandboxStatusResponse {
  kind: 'disabled' | 'worker-isolate' | 'http';
  ready: boolean;
  detail: string;
  capabilities: string[];
  isolationNotes: string[];
}

export interface SandboxExecRequest {
  /** Shell-style command (only meaningful for http sandboxes that provide one). */
  command?: string;
  /** JavaScript/TypeScript source executed inside the isolated sandbox. */
  code?: string;
  language?: 'javascript' | 'typescript' | 'python' | 'shell';
  projectId?: string;
  timeoutMs?: number;
  /** Files mounted read-only into the sandbox (http adapters only). */
  files?: Record<string, string>;
}

export interface SandboxExecResponse {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  error?: string;
  /** Which adapter actually ran it, so the UI can be explicit about isolation. */
  adapter: string;
}

/* ----------------------------------------------------------------- misc */

export interface TasksResponse {
  tasks: Task[];
}

export interface TaskCreateRequest {
  projectId?: string | null;
  title: string;
  detail?: string;
  status?: Task['status'];
  runId?: string | null;
}

export interface MemoryResponse {
  entries: MemoryEntry[];
}

export interface MemoryCreateRequest {
  scope: MemoryScope;
  scopeId?: string | null;
  key: string;
  content: string;
}

export interface UsageResponse {
  records: UsageRecord[];
  totals: { tokensIn: number; tokensOut: number; byProvider: Record<string, { tokensIn: number; tokensOut: number; calls: number }> };
}

export interface SettingsResponse {
  locale: 'ar' | 'en';
  dir: 'rtl' | 'ltr';
  defaults: Record<ModelClass, string | null>;
  agent: { maxSteps: number; autoApply: boolean; allowTerminal: boolean };
}

export interface SettingsUpdateRequest extends Partial<SettingsResponse> {}

export interface LocalProviderKeyStatus {
  provider: ProviderId;
  configured: boolean;
  masked?: string;
  baseUrl?: string;
  source?: 'saved' | 'env' | 'runtime';
}

export interface LocalProviderKeysResponse {
  writable: boolean;
  persisted: boolean;
  keys: LocalProviderKeyStatus[];
}

export interface LocalProviderKeyUpdateRequest {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  remove?: boolean;
}

export interface ApiError {
  error: string;
  code?: string;
  field?: string;
  hint?: string;
  /** True when the failure is "no real provider configured" — the UI must not fake it. */
  notConfigured?: boolean;
}

export type ChangeStatusValue = ChangeStatus;
