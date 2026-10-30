import type {
  AgentRun, AttachmentRef, ChatMessage, Commit, Conversation, FileChange, ISODate,
  MemoryEntry, MemoryScope, ModelClass, ModelInfo, Project, ProjectFile, Task, UsageRecord,
} from '@nova/shared';

export interface ConversationInput {
  title?: string;
  projectId?: string | null;
  modelId?: string | null;
  modelClass?: ModelClass;
  memoryEnabled?: boolean;
}

export interface ProjectInput {
  name: string;
  description?: string;
  language?: string;
}

export interface ChangeInput {
  projectId: string;
  runId?: string | null;
  path: string;
  kind: FileChange['kind'];
  before: string | null;
  after: string | null;
  reason?: string;
  status?: FileChange['status'];
}

export interface CommitInput {
  projectId: string;
  parentId?: string | null;
  message: string;
  author?: string;
  branch?: string;
  tree: Record<string, string>;
  stats: { files: number; additions: number; deletions: number };
}

export interface AttachmentInput {
  id: string;
  conversationId?: string | null;
  projectId?: string | null;
  name: string;
  mime: string;
  sizeBytes: number;
  blobKey: string;
  textExcerpt?: string | null;
}

export interface AttachmentRecord extends AttachmentRef {
  id: string;
  conversationId: string | null;
  projectId: string | null;
  blobKey: string;
  textExcerpt: string | null;
  createdAt: ISODate;
}

export interface UsageInput {
  provider: string;
  modelId: string;
  kind: UsageRecord['kind'];
  tokensIn: number;
  tokensOut: number;
}

export interface AppSettings {
  locale: 'ar' | 'en';
  defaults: Record<ModelClass, string | null>;
  agent: { maxSteps: number; autoApply: boolean; allowTerminal: boolean };
}

export const DEFAULT_SETTINGS: AppSettings = {
  locale: 'ar',
  defaults: { chat: null, reasoning: null, coding: null, 'long-context': null },
  agent: { maxSteps: 12, autoApply: false, allowTerminal: false },
};

export interface ProjectStats {
  files: number;
  commits: number;
  pendingChanges: number;
  openTasks: number;
}

/**
 * Everything the app persists, expressed as domain operations — never SQL.
 * Two implementations exist:
 *   - D1Store   : Cloudflare D1 (production + `wrangler dev --local`)
 *   - JsonStore : in-memory / file-backed (Node dev runtime + unit tests)
 * Swapping them is what keeps the rest of the codebase storage-agnostic.
 */
export interface Store {
  readonly kind: 'd1' | 'json';
  init(): Promise<void>;

  /* conversations */
  listConversations(opts?: { projectId?: string | null; limit?: number; includeArchived?: boolean }): Promise<Conversation[]>;
  createConversation(input: ConversationInput): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  updateConversation(id: string, patch: Partial<ConversationInput> & { archived?: boolean; title?: string }): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<void>;
  touchConversation(id: string): Promise<void>;

  /* messages */
  listMessages(conversationId: string, limit?: number): Promise<ChatMessage[]>;
  appendMessage(msg: Omit<ChatMessage, 'createdAt'> & { createdAt?: ISODate }): Promise<ChatMessage>;
  updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void>;
  countMessages(conversationId: string): Promise<number>;

  /* projects */
  listProjects(): Promise<Project[]>;
  createProject(input: ProjectInput): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project | null>;
  deleteProject(id: string): Promise<void>;
  projectStats(projectId: string): Promise<ProjectStats>;

  /* files */
  listFiles(projectId: string): Promise<ProjectFile[]>;
  getFile(projectId: string, path: string): Promise<ProjectFile | null>;
  putFile(projectId: string, path: string, content: string): Promise<ProjectFile>;
  deleteFile(projectId: string, path: string): Promise<void>;
  /** Content-addressed blob storage — what makes commit history restorable. */
  putBlob(sha: string, content: string): Promise<void>;
  getBlob(sha: string): Promise<string | null>;

  /* proposed changes */
  listChanges(projectId: string, status?: FileChange['status']): Promise<FileChange[]>;
  createChange(input: ChangeInput): Promise<FileChange>;
  getChange(id: string): Promise<FileChange | null>;
  updateChange(id: string, patch: Partial<Pick<FileChange, 'status' | 'reason' | 'appliedAt'>>): Promise<void>;

  /* commits */
  listCommits(projectId: string, limit?: number): Promise<Commit[]>;
  createCommit(input: CommitInput): Promise<Commit>;
  getCommit(projectId: string, id: string): Promise<Commit | null>;
  headCommit(projectId: string): Promise<Commit | null>;
  /** Newest commit id (the parent of the next commit). */
  headId(projectId: string): Promise<string | null>;

  /* tasks */
  listTasks(opts?: { projectId?: string | null; runId?: string | null }): Promise<Task[]>;
  createTask(input: { projectId?: string | null; runId?: string | null; title: string; detail?: string; status?: Task['status']; order?: number }): Promise<Task>;
  updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'detail' | 'status' | 'order'>>): Promise<Task | null>;
  deleteTask(id: string): Promise<void>;

  /* agent runs */
  createRun(input: { projectId: string | null; conversationId: string | null; modelId: string; providerId?: string; prompt: string }): Promise<AgentRun>;
  getRun(id: string): Promise<AgentRun | null>;
  listRuns(opts?: { projectId?: string | null; limit?: number }): Promise<AgentRun[]>;
  updateRun(id: string, patch: Partial<Pick<AgentRun, 'status' | 'steps' | 'summary' | 'error' | 'finishedAt'>>): Promise<void>;
  appendRunEvent(runId: string, type: string, payload: unknown): Promise<void>;
  listRunEvents(runId: string): Promise<{ seq: number; type: string; payload: unknown; createdAt: ISODate }[]>;

  /* memory */
  listMemory(scope: MemoryScope, scopeId?: string | null): Promise<MemoryEntry[]>;
  upsertMemory(input: { scope: MemoryScope; scopeId?: string | null; key: string; content: string }): Promise<MemoryEntry>;
  deleteMemory(id: string): Promise<void>;

  /* usage */
  recordUsage(input: UsageInput): Promise<void>;
  usageSummary(limit?: number): Promise<{ records: UsageRecord[]; totals: { tokensIn: number; tokensOut: number; byProvider: Record<string, { tokensIn: number; tokensOut: number; calls: number }> } }>;

  /* attachments */
  createAttachment(input: AttachmentInput): Promise<AttachmentRecord>;
  getAttachment(id: string): Promise<AttachmentRecord | null>;

  /* settings */
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  /* live catalog cache (Model Router) */
  cacheModels(models: ModelInfo[]): Promise<void>;
  cachedModels(provider?: string): Promise<ModelInfo[]>;
}
