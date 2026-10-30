import {
  DEFAULT_SETTINGS, type AppSettings, type AttachmentInput, type AttachmentRecord,
  type ChangeInput, type CommitInput, type ConversationInput, type ProjectInput, type ProjectStats,
  type Store, type UsageInput,
} from './types.js';
import type {
  AgentRun, ChatMessage, Commit, Conversation, FileChange, ISODate, MemoryEntry, MemoryScope,
  ModelClass, ModelInfo, Project, ProjectFile, Task, UsageRecord,
} from '@nova/shared';
import { detectLanguage, newId, nowIso, sha256Hex } from '@nova/shared';

/**
 * In-memory implementation of {@link Store} with optional JSON-file persistence.
 * Used by the Node dev runtime and by the test suite (where it runs purely in
 * memory, so tests never touch a real database).
 */

interface Tables {
  conversations: Conversation[];
  messages: (ChatMessage & { reasoning?: string })[];
  projects: Project[];
  files: ProjectFile[];
  blobs: { sha: string; content: string }[];
  changes: FileChange[];
  commits: Commit[];
  tasks: Task[];
  runs: AgentRun[];
  events: { runId: string; seq: number; type: string; payload: unknown; createdAt: ISODate }[];
  memory: MemoryEntry[];
  usage: UsageRecord[];
  attachments: AttachmentRecord[];
  settings: Record<string, string>;
  catalog: ModelInfo[];
}

function emptyTables(): Tables {
  return {
    conversations: [], messages: [], projects: [], files: [], blobs: [], changes: [], commits: [],
    tasks: [], runs: [], events: [], memory: [], usage: [], attachments: [],
    settings: {}, catalog: [],
  };
}

export interface JsonStoreOptions {
  /** File path to persist to (Node runtime). Omit for a pure in-memory store (tests). */
  persistPath?: string;
  /** Debounced flush interval in ms. */
  flushMs?: number;
}

export class JsonStore implements Store {
  readonly kind = 'json' as const;
  private t: Tables = emptyTables();
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fs: typeof import('node:fs') | null = null;

  constructor(private opts: JsonStoreOptions = {}) {}

  async init(): Promise<void> {
    if (!this.opts.persistPath) return;
    const fs = await import('node:fs');
    const path = await import('node:path');
    this.fs = fs;
    fs.mkdirSync(path.dirname(this.opts.persistPath), { recursive: true });
    if (fs.existsSync(this.opts.persistPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.opts.persistPath, 'utf8')) as Partial<Tables>;
        this.t = { ...emptyTables(), ...raw };
      } catch {
        this.t = emptyTables();
      }
    }
  }

  private markDirty() {
    if (!this.opts.persistPath) return;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.flushMs ?? 150);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (!this.opts.persistPath || !this.fs || !this.dirty) return;
    this.dirty = false;
    this.fs.writeFileSync(this.opts.persistPath, JSON.stringify(this.t, null, 0));
  }

  /* ------------------------------------------------------- conversations */

  async listConversations(opts: { projectId?: string | null; limit?: number; includeArchived?: boolean } = {}): Promise<Conversation[]> {
    // Insertion index is the tiebreaker: two rows created in the same millisecond
    // must keep a deterministic order (otherwise the newest commit/message can be
    // shadowed by an older one — this bit us in tests and would corrupt chat history).
    const rows = this.t.conversations
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => (opts.includeArchived ? true : !c.archived))
      .filter(({ c }) => (opts.projectId === undefined ? true : c.projectId === opts.projectId))
      .sort((a, b) => b.c.updatedAt.localeCompare(a.c.updatedAt) || b.i - a.i)
      .slice(0, opts.limit ?? 200);
    return rows.map(({ c }) => this.decorate(c));
  }

  private decorate(c: Conversation): Conversation {
    return { ...c, messageCount: this.t.messages.filter((m) => m.conversationId === c.id).length };
  }

  async createConversation(input: ConversationInput = {}): Promise<Conversation> {
    const now = nowIso();
    const c: Conversation = {
      id: newId('cv'),
      title: input.title?.trim() || 'محادثة جديدة',
      projectId: input.projectId ?? null,
      modelId: input.modelId ?? null,
      modelClass: input.modelClass ?? 'chat',
      memoryEnabled: input.memoryEnabled ?? true,
      archived: false,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
    this.t.conversations.push(c);
    this.markDirty();
    return c;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const c = this.t.conversations.find((x) => x.id === id);
    return c ? this.decorate(c) : null;
  }

  async updateConversation(id: string, patch: Partial<ConversationInput> & { archived?: boolean; title?: string }): Promise<Conversation | null> {
    const c = this.t.conversations.find((x) => x.id === id);
    if (!c) return null;
    if (patch.title !== undefined) c.title = patch.title;
    if (patch.modelId !== undefined) c.modelId = patch.modelId;
    if (patch.modelClass !== undefined) c.modelClass = patch.modelClass as ModelClass;
    if (patch.projectId !== undefined) c.projectId = patch.projectId;
    if (patch.memoryEnabled !== undefined) c.memoryEnabled = patch.memoryEnabled;
    if (patch.archived !== undefined) c.archived = patch.archived;
    c.updatedAt = nowIso();
    this.markDirty();
    return this.decorate(c);
  }

  async deleteConversation(id: string): Promise<void> {
    this.t.conversations = this.t.conversations.filter((c) => c.id !== id);
    this.t.messages = this.t.messages.filter((m) => m.conversationId !== id);
    this.markDirty();
  }

  async touchConversation(id: string): Promise<void> {
    const c = this.t.conversations.find((x) => x.id === id);
    if (c) {
      c.updatedAt = nowIso();
      this.markDirty();
    }
  }

  /* ------------------------------------------------------------ messages */

  async listMessages(conversationId: string, limit = 500): Promise<ChatMessage[]> {
    return this.t.messages
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.conversationId === conversationId)
      .sort((a, b) => a.m.createdAt.localeCompare(b.m.createdAt) || a.i - b.i)
      .slice(-limit)
      .map(({ m }) => m);
  }

  async appendMessage(msg: Omit<ChatMessage, 'createdAt'> & { createdAt?: ISODate }): Promise<ChatMessage> {
    const row = { ...msg, id: msg.id || newId('msg'), createdAt: msg.createdAt ?? nowIso() } as ChatMessage;
    this.t.messages.push(row as ChatMessage & { reasoning?: string });
    this.markDirty();
    await this.touchConversation(row.conversationId);
    return row;
  }

  async updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
    const m = this.t.messages.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    this.markDirty();
  }

  async countMessages(conversationId: string): Promise<number> {
    return this.t.messages.filter((m) => m.conversationId === conversationId).length;
  }

  /* ------------------------------------------------------------ projects */

  async listProjects(): Promise<Project[]> {
    const rows = this.t.projects
      .map((p, i) => ({ p, i }))
      .sort((a, b) => b.p.updatedAt.localeCompare(a.p.updatedAt) || b.i - a.i)
      .map(({ p }) => p);
    const out: Project[] = [];
    for (const p of rows) out.push({ ...p, stats: await this.projectStats(p.id) });
    return out;
  }

  async createProject(input: ProjectInput): Promise<Project> {
    const now = nowIso();
    const p: Project = {
      id: newId('prj'),
      name: input.name.trim(),
      description: input.description ?? '',
      language: input.language ?? 'typescript',
      defaultBranch: 'main',
      createdAt: now,
      updatedAt: now,
    };
    this.t.projects.push(p);
    this.markDirty();
    return { ...p, stats: await this.projectStats(p.id) };
  }

  async getProject(id: string): Promise<Project | null> {
    const p = this.t.projects.find((x) => x.id === id);
    return p ? { ...p, stats: await this.projectStats(p.id) } : null;
  }

  async updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project | null> {
    const p = this.t.projects.find((x) => x.id === id);
    if (!p) return null;
    if (patch.name !== undefined) p.name = patch.name.trim();
    if (patch.description !== undefined) p.description = patch.description;
    if (patch.language !== undefined) p.language = patch.language;
    p.updatedAt = nowIso();
    this.markDirty();
    return { ...p, stats: await this.projectStats(p.id) };
  }

  async deleteProject(id: string): Promise<void> {
    this.t.projects = this.t.projects.filter((p) => p.id !== id);
    this.t.files = this.t.files.filter((f) => f.projectId !== id);
    this.t.changes = this.t.changes.filter((c) => c.projectId !== id);
    this.t.commits = this.t.commits.filter((c) => c.projectId !== id);
    this.t.tasks = this.t.tasks.filter((t) => t.projectId !== id);
    this.markDirty();
  }

  async projectStats(projectId: string): Promise<ProjectStats> {
    return {
      files: this.t.files.filter((f) => f.projectId === projectId && f.status === 'active').length,
      commits: this.t.commits.filter((c) => c.projectId === projectId).length,
      pendingChanges: this.t.changes.filter((c) => c.projectId === projectId && c.status === 'pending').length,
      openTasks: this.t.tasks.filter((t) => t.projectId === projectId && t.status !== 'done' && t.status !== 'cancelled').length,
    };
  }

  /* --------------------------------------------------------------- files */

  async listFiles(projectId: string): Promise<ProjectFile[]> {
    return this.t.files
      .filter((f) => f.projectId === projectId && f.status === 'active')
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async getFile(projectId: string, path: string): Promise<ProjectFile | null> {
    return this.t.files.find((f) => f.projectId === projectId && f.path === path && f.status === 'active') ?? null;
  }

  async putFile(projectId: string, path: string, content: string): Promise<ProjectFile> {
    const now = nowIso();
    const sha = await sha256Hex(content);
    await this.putBlob(sha, content);
    const existing = this.t.files.find((f) => f.projectId === projectId && f.path === path && f.status === 'active');
    if (existing) {
      existing.content = content;
      existing.sha = sha;
      existing.sizeBytes = new TextEncoder().encode(content).length;
      existing.language = detectLanguage(path);
      existing.updatedAt = now;
      this.markDirty();
      return existing;
    }
    const file: ProjectFile = {
      id: newId('file'),
      projectId,
      path,
      content,
      sha,
      sizeBytes: new TextEncoder().encode(content).length,
      language: detectLanguage(path),
      status: 'active',
      updatedAt: now,
    };
    this.t.files.push(file);
    this.markDirty();
    const p = this.t.projects.find((x) => x.id === projectId);
    if (p) p.updatedAt = now;
    return file;
  }

  async putBlob(sha: string, content: string): Promise<void> {
    if (this.t.blobs.some((b) => b.sha === sha)) return;
    this.t.blobs.push({ sha, content });
    this.markDirty();
  }

  async getBlob(sha: string): Promise<string | null> {
    return this.t.blobs.find((b) => b.sha === sha)?.content ?? null;
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    const f = this.t.files.find((x) => x.projectId === projectId && x.path === path && x.status === 'active');
    if (f) {
      f.status = 'deleted';
      this.markDirty();
    }
  }

  /* ------------------------------------------------------------- changes */

  async listChanges(projectId: string, status?: FileChange['status']): Promise<FileChange[]> {
    return this.t.changes
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.projectId === projectId && (!status || c.status === status))
      .sort((a, b) => a.c.createdAt.localeCompare(b.c.createdAt) || a.i - b.i)
      .map(({ c }) => c);
  }

  async createChange(input: ChangeInput): Promise<FileChange> {
    const c: FileChange = {
      id: newId('chg'),
      projectId: input.projectId,
      runId: input.runId ?? null,
      path: input.path,
      kind: input.kind,
      before: input.before,
      after: input.after,
      status: input.status ?? 'pending',
      reason: input.reason,
      createdAt: nowIso(),
      appliedAt: null,
    };
    this.t.changes.push(c);
    this.markDirty();
    return c;
  }

  async getChange(id: string): Promise<FileChange | null> {
    return this.t.changes.find((c) => c.id === id) ?? null;
  }

  async updateChange(id: string, patch: Partial<Pick<FileChange, 'status' | 'reason' | 'appliedAt'>>): Promise<void> {
    const c = this.t.changes.find((x) => x.id === id);
    if (c) {
      Object.assign(c, patch);
      this.markDirty();
    }
  }

  /* ------------------------------------------------------------- commits */

  async listCommits(projectId: string, limit = 50): Promise<Commit[]> {
    return this.t.commits
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.projectId === projectId)
      .sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt) || b.i - a.i)
      .slice(0, limit)
      .map(({ c }) => c);
  }

  async createCommit(input: CommitInput): Promise<Commit> {
    const c: Commit = {
      id: newId('cmt'),
      projectId: input.projectId,
      parentId: input.parentId ?? null,
      message: input.message,
      author: input.author ?? 'nova',
      branch: input.branch ?? 'main',
      tree: input.tree,
      stats: input.stats,
      createdAt: nowIso(),
    };
    this.t.commits.push(c);
    this.markDirty();
    return c;
  }

  async getCommit(projectId: string, id: string): Promise<Commit | null> {
    return this.t.commits.find((c) => c.projectId === projectId && c.id === id) ?? null;
  }

  async headCommit(projectId: string): Promise<Commit | null> {
    const commits = await this.listCommits(projectId, 1);
    return commits[0] ?? null;
  }

  /** Newest commit id — used as the parent for the next commit. */
  async headId(projectId: string): Promise<string | null> {
    return (await this.headCommit(projectId))?.id ?? null;
  }

  /* --------------------------------------------------------------- tasks */

  async listTasks(opts: { projectId?: string | null; runId?: string | null } = {}): Promise<Task[]> {
    return this.t.tasks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => (opts.projectId === undefined ? true : t.projectId === opts.projectId))
      .filter(({ t }) => (opts.runId === undefined ? true : t.runId === opts.runId))
      .sort((a, b) => a.t.order - b.t.order || a.t.createdAt.localeCompare(b.t.createdAt) || a.i - b.i)
      .map(({ t }) => t);
  }

  async createTask(input: { projectId?: string | null; runId?: string | null; title: string; detail?: string; status?: Task['status']; order?: number }): Promise<Task> {
    const now = nowIso();
    const order = input.order ?? (this.t.tasks.filter((t) => t.projectId === (input.projectId ?? null)).length + 1);
    const t: Task = {
      id: newId('task'),
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      title: input.title,
      detail: input.detail ?? '',
      status: input.status ?? 'pending',
      order,
      createdAt: now,
      updatedAt: now,
    };
    this.t.tasks.push(t);
    this.markDirty();
    return t;
  }

  async updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'detail' | 'status' | 'order'>>): Promise<Task | null> {
    const t = this.t.tasks.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    t.updatedAt = nowIso();
    this.markDirty();
    return t;
  }

  async deleteTask(id: string): Promise<void> {
    this.t.tasks = this.t.tasks.filter((t) => t.id !== id);
    this.markDirty();
  }

  /* ---------------------------------------------------------- agent runs */

  async createRun(input: { projectId: string | null; conversationId: string | null; modelId: string; providerId?: string; prompt: string }): Promise<AgentRun> {
    const run: AgentRun = {
      id: newId('run'),
      projectId: input.projectId,
      conversationId: input.conversationId,
      modelId: input.modelId,
      status: 'running',
      steps: 0,
      startedAt: nowIso(),
      finishedAt: null,
    };
    (run as AgentRun & { providerId?: string }).providerId = input.providerId;
    (run as AgentRun & { prompt?: string }).prompt = input.prompt;
    this.t.runs.push(run);
    this.markDirty();
    return run;
  }

  async getRun(id: string): Promise<AgentRun | null> {
    return this.t.runs.find((r) => r.id === id) ?? null;
  }

  async listRuns(opts: { projectId?: string | null; limit?: number } = {}): Promise<AgentRun[]> {
    return this.t.runs
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => (opts.projectId === undefined ? true : r.projectId === opts.projectId))
      .sort((a, b) => b.r.startedAt.localeCompare(a.r.startedAt) || b.i - a.i)
      .slice(0, opts.limit ?? 50)
      .map(({ r }) => r);
  }

  async updateRun(id: string, patch: Partial<Pick<AgentRun, 'status' | 'steps' | 'summary' | 'error' | 'finishedAt'>>): Promise<void> {
    const r = this.t.runs.find((x) => x.id === id);
    if (r) {
      Object.assign(r, patch);
      this.markDirty();
    }
  }

  async appendRunEvent(runId: string, type: string, payload: unknown): Promise<void> {
    const seq = this.t.events.filter((e) => e.runId === runId).length + 1;
    this.t.events.push({ runId, seq, type, payload, createdAt: nowIso() });
    this.markDirty();
  }

  async listRunEvents(runId: string) {
    return this.t.events.filter((e) => e.runId === runId).sort((a, b) => a.seq - b.seq);
  }

  /* -------------------------------------------------------------- memory */

  async listMemory(scope: MemoryScope, scopeId: string | null = null): Promise<MemoryEntry[]> {
    return this.t.memory
      .filter((m) => m.scope === scope && (m.scopeId ?? null) === (scopeId ?? null))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async upsertMemory(input: { scope: MemoryScope; scopeId?: string | null; key: string; content: string }): Promise<MemoryEntry> {
    const now = nowIso();
    const existing = this.t.memory.find(
      (m) => m.scope === input.scope && (m.scopeId ?? null) === (input.scopeId ?? null) && m.key === input.key,
    );
    if (existing) {
      existing.content = input.content;
      existing.updatedAt = now;
      this.markDirty();
      return existing;
    }
    const entry: MemoryEntry = {
      id: newId('mem'),
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      key: input.key,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    };
    this.t.memory.push(entry);
    this.markDirty();
    return entry;
  }

  async deleteMemory(id: string): Promise<void> {
    this.t.memory = this.t.memory.filter((m) => m.id !== id);
    this.markDirty();
  }

  /* --------------------------------------------------------------- usage */

  async recordUsage(input: UsageInput): Promise<void> {
    this.t.usage.push({
      id: newId('use'),
      createdAt: nowIso(),
      provider: input.provider as UsageRecord['provider'],
      modelId: input.modelId,
      kind: input.kind,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
    });
    this.markDirty();
  }

  async usageSummary(limit = 200) {
    const records = this.t.usage
      .map((u, i) => ({ u, i }))
      .sort((a, b) => b.u.createdAt.localeCompare(a.u.createdAt) || b.i - a.i)
      .slice(0, limit)
      .map(({ u }) => u);
    const byProvider: Record<string, { tokensIn: number; tokensOut: number; calls: number }> = {};
    let tokensIn = 0;
    let tokensOut = 0;
    for (const r of this.t.usage) {
      tokensIn += r.tokensIn;
      tokensOut += r.tokensOut;
      const p = (byProvider[r.provider] ??= { tokensIn: 0, tokensOut: 0, calls: 0 });
      p.tokensIn += r.tokensIn;
      p.tokensOut += r.tokensOut;
      p.calls += 1;
    }
    return { records, totals: { tokensIn, tokensOut, byProvider } };
  }

  /* --------------------------------------------------------- attachments */

  async createAttachment(input: AttachmentInput): Promise<AttachmentRecord> {
    const rec: AttachmentRecord = {
      id: input.id,
      conversationId: input.conversationId ?? null,
      projectId: input.projectId ?? null,
      name: input.name,
      mime: input.mime,
      size: input.sizeBytes,
      url: `/api/uploads/${input.id}`,
      blobKey: input.blobKey,
      text: input.textExcerpt ?? undefined,
      textExcerpt: input.textExcerpt ?? null,
      createdAt: nowIso(),
    };
    this.t.attachments.push(rec);
    this.markDirty();
    return rec;
  }

  async getAttachment(id: string): Promise<AttachmentRecord | null> {
    return this.t.attachments.find((a) => a.id === id) ?? null;
  }

  /* ------------------------------------------------------------ settings */

  async getSettings(): Promise<AppSettings> {
    const raw = this.t.settings['app'];
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    try {
      return { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(raw) } as AppSettings;
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const next: AppSettings = {
      ...current,
      ...patch,
      defaults: { ...current.defaults, ...(patch.defaults ?? {}) } as Record<ModelClass, string | null>,
      agent: { ...current.agent, ...(patch.agent ?? {}) },
    };
    this.t.settings['app'] = JSON.stringify(next);
    this.markDirty();
    return next;
  }

  /* ------------------------------------------------------------- catalog */

  async cacheModels(models: ModelInfo[]): Promise<void> {
    for (const m of models) {
      const i = this.t.catalog.findIndex((c) => c.id === m.id);
      if (i >= 0) this.t.catalog[i] = m;
      else this.t.catalog.push(m);
    }
    this.markDirty();
  }

  async cachedModels(provider?: string): Promise<ModelInfo[]> {
    return provider ? this.t.catalog.filter((m) => m.provider === provider) : [...this.t.catalog];
  }
}
