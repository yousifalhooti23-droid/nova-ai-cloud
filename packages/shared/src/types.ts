/**
 * Core domain types shared by the web app and the worker.
 * Keeping them in one package is what makes the Model Router swappable:
 * every layer speaks these types, never provider-specific shapes.
 */

export type ID = string;
export type ISODate = string;

/* ------------------------------------------------------------------ models */

export type ModelClass = 'chat' | 'reasoning' | 'coding' | 'long-context';

export const MODEL_CLASSES: ModelClass[] = ['chat', 'reasoning', 'coding', 'long-context'];

export type ProviderId =
  | 'workers-ai'
  | 'openrouter'
  | 'groq'
  | 'custom'
  | 'diagnostic';

export type FreeTier = 'free' | 'paid' | 'unknown';

export interface ModelInfo {
  /** Canonical id used across the app: "<provider>:<upstream-id>". */
  id: string;
  provider: ProviderId;
  /** Id sent to the upstream provider. */
  upstreamId: string;
  label: string;
  vendor: string;
  /** Which router classes this model can serve. */
  classes: ModelClass[];
  contextWindow: number;
  maxOutputTokens?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsSystemRole: boolean;
  pricing: { inputPerMTok: number; outputPerMTok: number } | null;
  freeTier: FreeTier;
  /** `gated` = provider requires an access request/form before first use. */
  access: 'open' | 'gated';
  /** Where/when the availability claim was checked. Never guess this. */
  verifiedAt?: ISODate;
  verifiedSource?: string;
  notes?: string;
}

export type ProviderStatus =
  | 'ready'
  | 'missing-key'
  | 'needs-remote'
  | 'disabled'
  | 'unreachable'
  | 'error';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  status: ProviderStatus;
  /** Human readable reason, safe to show in the UI (never contains secrets). */
  detail: string;
  modelCount: number;
  /** True when this provider cannot produce real model output in this runtime. */
  simulated: boolean;
  docsUrl?: string;
}

export interface ResolvedModel {
  model: ModelInfo;
  provider: ProviderId;
  /** Why this model was chosen (explicit user pick, class default, fallback...). */
  via: 'explicit' | 'class-default' | 'fallback' | 'override';
  warnings: string[];
}

/* ------------------------------------------------------------------- chat */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AttachmentRef {
  id: ID;
  name: string;
  mime: string;
  size: number;
  url: string;
  /** Extracted text (when the file is textual) — this is what reaches the model. */
  text?: string;
}

export interface ChatMessage {
  id: ID;
  conversationId: ID;
  role: Role;
  content: string;
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  toolName?: string;
  attachments?: AttachmentRef[];
  modelId?: string;
  providerId?: ProviderId;
  status: 'streaming' | 'complete' | 'error' | 'aborted';
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
  createdAt: ISODate;
}

export interface Conversation {
  id: ID;
  title: string;
  projectId: ID | null;
  modelId: string | null;
  modelClass: ModelClass;
  /** Memory is scoped per project; this flag exposes it to the conversation. */
  memoryEnabled: boolean;
  archived: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
  messageCount: number;
}

/* ---------------------------------------------------------------- projects */

export type FileStatus = 'active' | 'deleted';

export interface ProjectFile {
  id: ID;
  projectId: ID;
  path: string;
  content: string;
  sha: string;
  sizeBytes: number;
  language: string;
  status: FileStatus;
  updatedAt: ISODate;
}

export interface Project {
  id: ID;
  name: string;
  description: string;
  language: string;
  defaultBranch: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  stats?: { files: number; commits: number; pendingChanges: number; openTasks: number };
}

export type ChangeKind = 'create' | 'update' | 'delete';
export type ChangeStatus = 'pending' | 'applied' | 'rejected';

/**
 * A proposed file mutation produced by the coding agent.
 * Nothing touches the project tree until the user approves it.
 */
export interface FileChange {
  id: ID;
  projectId: ID;
  runId: ID | null;
  path: string;
  kind: ChangeKind;
  before: string | null;
  after: string | null;
  status: ChangeStatus;
  reason?: string;
  createdAt: ISODate;
  appliedAt?: ISODate | null;
}

export interface Commit {
  id: ID;
  projectId: ID;
  parentId: ID | null;
  message: string;
  author: string;
  branch: string;
  tree: Record<string, string>;
  stats: { files: number; additions: number; deletions: number };
  createdAt: ISODate;
}

/* ------------------------------------------------------------------ agent */

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

export interface Task {
  id: ID;
  projectId: ID | null;
  runId: ID | null;
  title: string;
  detail: string;
  status: TaskStatus;
  order: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type ToolName =
  | 'read_file'
  | 'list_files'
  | 'search_project'
  | 'write_file'
  | 'edit_file'
  | 'delete_file'
  | 'plan_tasks'
  | 'update_task'
  | 'run_command'
  | 'verify_code'
  | 'git_status'
  | 'git_commit'
  | 'git_diff'
  | 'git_log'
  | 'read_memory'
  | 'write_memory';

export type ToolRisk = 'read-only' | 'proposal' | 'needs-approval' | 'destructive';

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  risk: ToolRisk;
  parameters: Record<string, unknown>;
}

export type AgentRunStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface AgentRun {
  id: ID;
  projectId: ID | null;
  conversationId: ID | null;
  modelId: string;
  status: AgentRunStatus;
  steps: number;
  startedAt: ISODate;
  finishedAt: ISODate | null;
  summary?: string;
  error?: string;
}

/* ----------------------------------------------------------------- memory */

export type MemoryScope = 'global' | 'project';

export interface MemoryEntry {
  id: ID;
  scope: MemoryScope;
  scopeId: ID | null;
  key: string;
  content: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/* ------------------------------------------------------------------ usage */

export interface UsageRecord {
  id: ID;
  createdAt: ISODate;
  provider: ProviderId;
  modelId: string;
  kind: 'chat' | 'agent' | 'title' | 'memory';
  tokensIn: number;
  tokensOut: number;
}

export interface ProviderNotConfiguredError extends Error {
  code: 'provider_not_configured';
}
