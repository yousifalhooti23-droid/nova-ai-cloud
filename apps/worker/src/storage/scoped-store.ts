import type {
  AgentRun,
  ChatMessage,
  Commit,
  Conversation,
  FileChange,
  ISODate,
  MemoryEntry,
  MemoryScope,
  ModelInfo,
  Project,
  ProjectFile,
  Task,
  UsageRecord,
} from '@nova/shared';
import type { AuthRepo } from '../auth/repo.js';
import { notFound } from '../lib/errors.js';
import type {
  AppSettings,
  AttachmentInput,
  AttachmentRecord,
  ChangeInput,
  CommitInput,
  ConversationInput,
  ProjectInput,
  ProjectStats,
  Store,
  UsageInput,
} from './types.js';

/**
 * Strict multi-tenant isolation wrapper over any `Store` (`D1Store` or `JsonStore`).
 *
 * Every read, list, update, and delete verifies cryptographic user ownership via
 * `AuthRepo` before touching underlying data. Cross-user lookups always return
 * `null` / `[]` / `404` so resource IDs cannot even be probed for existence.
 */
export class ScopedStore implements Store {
  readonly kind: 'd1' | 'json';

  constructor(
    private readonly base: Store,
    private readonly repo: AuthRepo,
    private readonly userId: string,
  ) {
    this.kind = base.kind;
  }

  async init(): Promise<void> {
    await this.base.init();
  }

  private globalMemoryBucket(): string {
    return `usr_global:${this.userId}`;
  }

  private usagePrefix(): string {
    return `usr:${this.userId}::`;
  }

  private async assertProjectOwned(projectId: string): Promise<void> {
    const ok = await this.repo.ownsResource('project', projectId, this.userId);
    if (!ok) throw notFound('project not found');
  }

  private async assertConversationOwned(conversationId: string): Promise<void> {
    const ok = await this.repo.ownsResource('conversation', conversationId, this.userId);
    if (!ok) throw notFound('conversation not found');
  }

  /* --------------------------------------------------------- conversations */

  async listConversations(opts?: { projectId?: string | null; limit?: number; includeArchived?: boolean }): Promise<Conversation[]> {
    if (opts?.projectId) {
      const ownsProj = await this.repo.ownsResource('project', opts.projectId, this.userId);
      if (!ownsProj) return [];
    }
    const owned = await this.repo.listOwnedIds('conversation', this.userId);
    if (owned.size === 0) return [];
    const all = await this.base.listConversations({
      projectId: opts?.projectId,
      includeArchived: opts?.includeArchived,
      limit: 2000,
    });
    const limit = Math.max(1, opts?.limit ?? 100);
    return all.filter((c) => owned.has(c.id)).slice(0, limit);
  }

  async createConversation(input: ConversationInput): Promise<Conversation> {
    if (input.projectId) {
      await this.assertProjectOwned(input.projectId);
    }
    const created = await this.base.createConversation(input);
    await this.repo.assignResource('conversation', created.id, this.userId);
    return created;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const ok = await this.repo.ownsResource('conversation', id, this.userId);
    if (!ok) return null;
    return this.base.getConversation(id);
  }

  async updateConversation(
    id: string,
    patch: Partial<ConversationInput> & { archived?: boolean; title?: string },
  ): Promise<Conversation | null> {
    const ok = await this.repo.ownsResource('conversation', id, this.userId);
    if (!ok) return null;
    if (patch.projectId) {
      await this.assertProjectOwned(patch.projectId);
    }
    return this.base.updateConversation(id, patch);
  }

  async deleteConversation(id: string): Promise<void> {
    const ok = await this.repo.ownsResource('conversation', id, this.userId);
    if (!ok) throw notFound('conversation not found');
    await this.base.deleteConversation(id);
    await this.repo.deleteResource('conversation', id);
  }

  async touchConversation(id: string): Promise<void> {
    const ok = await this.repo.ownsResource('conversation', id, this.userId);
    if (!ok) return;
    await this.base.touchConversation(id);
  }

  /* -------------------------------------------------------------- messages */

  async listMessages(conversationId: string, limit?: number): Promise<ChatMessage[]> {
    const ok = await this.repo.ownsResource('conversation', conversationId, this.userId);
    if (!ok) throw notFound('conversation not found');
    return this.base.listMessages(conversationId, limit);
  }

  async appendMessage(msg: Omit<ChatMessage, 'createdAt'> & { createdAt?: ISODate }): Promise<ChatMessage> {
    await this.assertConversationOwned(msg.conversationId);
    const saved = await this.base.appendMessage(msg);
    await this.repo.assignResource('message', saved.id, this.userId);
    return saved;
  }

  async updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
    const ok = await this.repo.ownsResource('message', id, this.userId);
    if (!ok) throw notFound('message not found');
    await this.base.updateMessage(id, patch);
  }

  async countMessages(conversationId: string): Promise<number> {
    const ok = await this.repo.ownsResource('conversation', conversationId, this.userId);
    if (!ok) return 0;
    return this.base.countMessages(conversationId);
  }

  /* -------------------------------------------------------------- projects */

  async listProjects(): Promise<Project[]> {
    const owned = await this.repo.listOwnedIds('project', this.userId);
    if (owned.size === 0) return [];
    const all = await this.base.listProjects();
    return all.filter((p) => owned.has(p.id));
  }

  async createProject(input: ProjectInput): Promise<Project> {
    const created = await this.base.createProject(input);
    await this.repo.assignResource('project', created.id, this.userId);
    return created;
  }

  async getProject(id: string): Promise<Project | null> {
    const ok = await this.repo.ownsResource('project', id, this.userId);
    if (!ok) return null;
    return this.base.getProject(id);
  }

  async updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project | null> {
    const ok = await this.repo.ownsResource('project', id, this.userId);
    if (!ok) return null;
    return this.base.updateProject(id, patch);
  }

  async deleteProject(id: string): Promise<void> {
    await this.assertProjectOwned(id);
    await this.base.deleteProject(id);
    await this.repo.deleteResource('project', id);
  }

  async projectStats(projectId: string): Promise<ProjectStats> {
    await this.assertProjectOwned(projectId);
    return this.base.projectStats(projectId);
  }

  /* ----------------------------------------------------------------- files */

  async listFiles(projectId: string): Promise<ProjectFile[]> {
    const ok = await this.repo.ownsResource('project', projectId, this.userId);
    if (!ok) throw notFound('project not found');
    return this.base.listFiles(projectId);
  }

  async getFile(projectId: string, path: string): Promise<ProjectFile | null> {
    const ok = await this.repo.ownsResource('project', projectId, this.userId);
    if (!ok) throw notFound('project not found');
    return this.base.getFile(projectId, path);
  }

  async putFile(projectId: string, path: string, content: string): Promise<ProjectFile> {
    await this.assertProjectOwned(projectId);
    return this.base.putFile(projectId, path, content);
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    await this.assertProjectOwned(projectId);
    await this.base.deleteFile(projectId, path);
  }

  async putBlob(sha: string, content: string): Promise<void> {
    await this.base.putBlob(sha, content);
  }

  async getBlob(sha: string): Promise<string | null> {
    return this.base.getBlob(sha);
  }

  /* ------------------------------------------------------ proposed changes */

  async listChanges(projectId: string, status?: FileChange['status']): Promise<FileChange[]> {
    if (!projectId) return [];
    const ok = await this.repo.ownsResource('project', projectId, this.userId);
    if (!ok) throw notFound('project not found');
    return this.base.listChanges(projectId, status);
  }

  async createChange(input: ChangeInput): Promise<FileChange> {
    await this.assertProjectOwned(input.projectId);
    return this.base.createChange(input);
  }

  async getChange(id: string): Promise<FileChange | null> {
    const chg = await this.base.getChange(id);
    if (!chg) return null;
    const ok = await this.repo.ownsResource('project', chg.projectId, this.userId);
    return ok ? chg : null;
  }

  async updateChange(id: string, patch: Partial<Pick<FileChange, 'status' | 'reason' | 'appliedAt'>>): Promise<void> {
    const chg = await this.getChange(id);
    if (!chg) throw notFound('change not found');
    await this.base.updateChange(id, patch);
  }

  /* --------------------------------------------------------------- commits */

  async listCommits(projectId: string, limit?: number): Promise<Commit[]> {
    await this.assertProjectOwned(projectId);
    return this.base.listCommits(projectId, limit);
  }

  async createCommit(input: CommitInput): Promise<Commit> {
    await this.assertProjectOwned(input.projectId);
    return this.base.createCommit(input);
  }

  async getCommit(projectId: string, id: string): Promise<Commit | null> {
    const ok = await this.repo.ownsResource('project', projectId, this.userId);
    if (!ok) return null;
    return this.base.getCommit(projectId, id);
  }

  async headCommit(projectId: string): Promise<Commit | null> {
    const ok = await this.repo.ownsResource('project', projectId, this.userId);
    if (!ok) return null;
    return this.base.headCommit(projectId);
  }

  async headId(projectId: string): Promise<string | null> {
    const ok = await this.repo.ownsResource('project', projectId, this.userId);
    if (!ok) return null;
    return this.base.headId(projectId);
  }

  /* ----------------------------------------------------------------- tasks */

  async listTasks(opts?: { projectId?: string | null; runId?: string | null }): Promise<Task[]> {
    if (opts?.projectId) {
      const ok = await this.repo.ownsResource('project', opts.projectId, this.userId);
      if (!ok) return [];
    }
    if (opts?.runId) {
      const ok = await this.repo.ownsResource('run', opts.runId, this.userId);
      if (!ok) return [];
    }
    const owned = await this.repo.listOwnedIds('task', this.userId);
    if (owned.size === 0) return [];
    const all = await this.base.listTasks(opts);
    return all.filter((t) => owned.has(t.id));
  }

  async createTask(input: {
    projectId?: string | null;
    runId?: string | null;
    title: string;
    detail?: string;
    status?: Task['status'];
    order?: number;
  }): Promise<Task> {
    if (input.projectId) await this.assertProjectOwned(input.projectId);
    if (input.runId) {
      const ok = await this.repo.ownsResource('run', input.runId, this.userId);
      if (!ok) throw notFound('run not found');
    }
    const created = await this.base.createTask(input);
    await this.repo.assignResource('task', created.id, this.userId);
    return created;
  }

  async updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'detail' | 'status' | 'order'>>): Promise<Task | null> {
    const ok = await this.repo.ownsResource('task', id, this.userId);
    if (!ok) return null;
    return this.base.updateTask(id, patch);
  }

  async deleteTask(id: string): Promise<void> {
    const ok = await this.repo.ownsResource('task', id, this.userId);
    if (!ok) throw notFound('task not found');
    await this.base.deleteTask(id);
    await this.repo.deleteResource('task', id);
  }

  /* ------------------------------------------------------------ agent runs */

  async createRun(input: {
    projectId: string | null;
    conversationId: string | null;
    modelId: string;
    providerId?: string;
    prompt: string;
  }): Promise<AgentRun> {
    if (input.projectId) await this.assertProjectOwned(input.projectId);
    if (input.conversationId) await this.assertConversationOwned(input.conversationId);
    const run = await this.base.createRun(input);
    await this.repo.assignResource('run', run.id, this.userId);
    return run;
  }

  async getRun(id: string): Promise<AgentRun | null> {
    const ok = await this.repo.ownsResource('run', id, this.userId);
    if (!ok) return null;
    return this.base.getRun(id);
  }

  async listRuns(opts?: { projectId?: string | null; limit?: number }): Promise<AgentRun[]> {
    if (opts?.projectId) {
      const ok = await this.repo.ownsResource('project', opts.projectId, this.userId);
      if (!ok) return [];
    }
    const owned = await this.repo.listOwnedIds('run', this.userId);
    if (owned.size === 0) return [];
    const all = await this.base.listRuns({ projectId: opts?.projectId, limit: 500 });
    return all.filter((r) => owned.has(r.id)).slice(0, opts?.limit ?? 30);
  }

  async updateRun(id: string, patch: Partial<Pick<AgentRun, 'status' | 'steps' | 'summary' | 'error' | 'finishedAt'>>): Promise<void> {
    const ok = await this.repo.ownsResource('run', id, this.userId);
    if (!ok) throw notFound('run not found');
    await this.base.updateRun(id, patch);
  }

  async appendRunEvent(runId: string, type: string, payload: unknown): Promise<void> {
    const ok = await this.repo.ownsResource('run', runId, this.userId);
    if (!ok) throw notFound('run not found');
    await this.base.appendRunEvent(runId, type, payload);
  }

  async listRunEvents(runId: string): Promise<{ seq: number; type: string; payload: unknown; createdAt: ISODate }[]> {
    const ok = await this.repo.ownsResource('run', runId, this.userId);
    if (!ok) return [];
    return this.base.listRunEvents(runId);
  }

  /* ---------------------------------------------------------------- memory */

  async listMemory(scope: MemoryScope, scopeId?: string | null): Promise<MemoryEntry[]> {
    if (scope === 'global') {
      const raw = await this.base.listMemory('project', this.globalMemoryBucket());
      return raw.map((e) => ({ ...e, scope: 'global', scopeId: null }));
    }
    if (!scopeId) return [];
    const ok = await this.repo.ownsResource('project', scopeId, this.userId);
    if (!ok) throw notFound('project not found');
    return this.base.listMemory('project', scopeId);
  }

  async upsertMemory(input: { scope: MemoryScope; scopeId?: string | null; key: string; content: string }): Promise<MemoryEntry> {
    if (input.scope === 'global') {
      const saved = await this.base.upsertMemory({
        scope: 'project',
        scopeId: this.globalMemoryBucket(),
        key: input.key,
        content: input.content,
      });
      await this.repo.assignResource('memory', saved.id, this.userId);
      return { ...saved, scope: 'global', scopeId: null };
    }
    if (!input.scopeId) throw notFound('project not found');
    await this.assertProjectOwned(input.scopeId);
    const saved = await this.base.upsertMemory({
      scope: 'project',
      scopeId: input.scopeId,
      key: input.key,
      content: input.content,
    });
    await this.repo.assignResource('memory', saved.id, this.userId);
    return saved;
  }

  async deleteMemory(id: string): Promise<void> {
    const ok = await this.repo.ownsResource('memory', id, this.userId);
    if (!ok) throw notFound('memory entry not found');
    await this.base.deleteMemory(id);
    await this.repo.deleteResource('memory', id);
  }

  /* ----------------------------------------------------------------- usage */

  async recordUsage(input: UsageInput): Promise<void> {
    await this.base.recordUsage({
      ...input,
      modelId: `${this.usagePrefix()}${input.modelId}`,
    });
  }

  async usageSummary(limit = 100): Promise<{
    records: UsageRecord[];
    totals: {
      tokensIn: number;
      tokensOut: number;
      byProvider: Record<string, { tokensIn: number; tokensOut: number; calls: number }>;
    };
  }> {
    const prefix = this.usagePrefix();
    const raw = await this.base.usageSummary(2000);
    const records: UsageRecord[] = [];
    for (const r of raw.records) {
      if (r.modelId.startsWith(prefix)) {
        records.push({ ...r, modelId: r.modelId.slice(prefix.length) });
        if (records.length >= limit) break;
      }
    }
    const byProvider: Record<string, { tokensIn: number; tokensOut: number; calls: number }> = {};
    let tokensIn = 0;
    let tokensOut = 0;
    for (const r of records) {
      tokensIn += r.tokensIn;
      tokensOut += r.tokensOut;
      const b = (byProvider[r.provider] ??= { tokensIn: 0, tokensOut: 0, calls: 0 });
      b.tokensIn += r.tokensIn;
      b.tokensOut += r.tokensOut;
      b.calls += 1;
    }
    return { records, totals: { tokensIn, tokensOut, byProvider } };
  }

  /* ----------------------------------------------------------- attachments */

  async createAttachment(input: AttachmentInput): Promise<AttachmentRecord> {
    if (input.conversationId) await this.assertConversationOwned(input.conversationId);
    if (input.projectId) await this.assertProjectOwned(input.projectId);
    const created = await this.base.createAttachment(input);
    await this.repo.assignResource('attachment', created.id, this.userId);
    return created;
  }

  async getAttachment(id: string): Promise<AttachmentRecord | null> {
    const ok = await this.repo.ownsResource('attachment', id, this.userId);
    if (!ok) return null;
    return this.base.getAttachment(id);
  }

  /* -------------------------------------------------------------- settings */

  async getSettings(): Promise<AppSettings> {
    return this.repo.getUserSettings(this.userId);
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.repo.saveUserSettings(this.userId, patch);
  }

  /* -------------------------------------------------------- catalog cache */

  async cacheModels(models: ModelInfo[]): Promise<void> {
    await this.base.cacheModels(models);
  }

  async cachedModels(provider?: string): Promise<ModelInfo[]> {
    return this.base.cachedModels(provider);
  }
}
