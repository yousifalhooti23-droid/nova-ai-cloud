import {
  DEFAULT_SETTINGS, type AppSettings, type AttachmentInput, type AttachmentRecord,
  type ChangeInput, type CommitInput, type ConversationInput, type ProjectInput,
  type ProjectStats, type Store, type UsageInput,
} from './types.js';
import type {
  AgentRun, AttachmentRef, ChatMessage, Commit, Conversation, FileChange, ISODate, MemoryEntry,
  MemoryScope, ModelClass, ModelInfo, Project, ProjectFile, ProviderId, Task, UsageRecord,
} from '@nova/shared';
import { detectLanguage, newId, nowIso, sha256Hex } from '@nova/shared';

/** Minimal structural type for the D1 binding (avoids a hard dep on workers-types at build time). */
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(stmts: D1Statement[]): Promise<unknown[]>;
}
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{ results?: T[]; success: boolean; meta?: { changes?: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v ?? d) || d);
const bool = (v: unknown): boolean => v === 1 || v === true || v === '1';
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined || v === '') return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

/**
 * Cloudflare D1 implementation of {@link Store}.
 * Every query is parameterised; nothing is string-concatenated.
 */
export class D1Store implements Store {
  readonly kind = 'd1' as const;
  constructor(private db: D1Like) {}

  async init(): Promise<void> {
    // Schema is created by migrations (`wrangler d1 migrations apply`).
    // Ensure cardless blob chunks table exists even on older D1 databases.
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS uploaded_blob_chunks (
           blob_key     TEXT NOT NULL,
           chunk_idx    INTEGER NOT NULL,
           content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
           total_size   INTEGER NOT NULL DEFAULT 0,
           data_b64     TEXT NOT NULL,
           created_at   TEXT NOT NULL,
           PRIMARY KEY (blob_key, chunk_idx)
         )`,
      )
      .run();
  }

  /* ------------------------------------------------------- conversations */

  private mapConversation(r: Row, messageCount = 0): Conversation {
    return {
      id: str(r.id),
      title: str(r.title),
      projectId: strOrNull(r.project_id),
      modelId: strOrNull(r.model_id),
      modelClass: (str(r.model_class) || 'chat') as ModelClass,
      memoryEnabled: bool(r.memory_enabled),
      archived: bool(r.archived),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
      messageCount: num(r.message_count, messageCount),
    };
  }

  async listConversations(opts: { projectId?: string | null; limit?: number; includeArchived?: boolean } = {}): Promise<Conversation[]> {
    const where: string[] = [];
    const bind: unknown[] = [];
    if (!opts.includeArchived) where.push('c.archived = 0');
    if (opts.projectId !== undefined) {
      if (opts.projectId === null) where.push('c.project_id IS NULL');
      else {
        where.push('c.project_id = ?');
        bind.push(opts.projectId);
      }
    }
    bind.push(opts.limit ?? 200);
    const sql = `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
                 FROM conversations c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY c.updated_at DESC, c.rowid DESC LIMIT ?`;
    const { results } = await this.db.prepare(sql).bind(...bind).all<Row>();
    return results.map((r) => this.mapConversation(r));
  }

  async createConversation(input: ConversationInput = {}): Promise<Conversation> {
    const now = nowIso();
    const id = newId('cv');
    const title = input.title?.trim() || 'محادثة جديدة';
    await this.db
      .prepare(
        `INSERT INTO conversations (id, title, project_id, model_id, model_class, memory_enabled, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .bind(id, title, input.projectId ?? null, input.modelId ?? null, input.modelClass ?? 'chat', input.memoryEnabled === false ? 0 : 1, now, now)
      .run();
    return {
      id, title, projectId: input.projectId ?? null, modelId: input.modelId ?? null,
      modelClass: input.modelClass ?? 'chat', memoryEnabled: input.memoryEnabled !== false,
      archived: false, createdAt: now, updatedAt: now, messageCount: 0,
    };
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const r = await this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c WHERE c.id = ?`,
      )
      .bind(id)
      .first<Row>();
    return r ? this.mapConversation(r) : null;
  }

  async updateConversation(id: string, patch: Partial<ConversationInput> & { archived?: boolean; title?: string }): Promise<Conversation | null> {
    const sets: string[] = [];
    const bind: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col} = ?`);
      bind.push(val);
    };
    if (patch.title !== undefined) push('title', patch.title);
    if (patch.modelId !== undefined) push('model_id', patch.modelId);
    if (patch.modelClass !== undefined) push('model_class', patch.modelClass);
    if (patch.projectId !== undefined) push('project_id', patch.projectId);
    if (patch.memoryEnabled !== undefined) push('memory_enabled', patch.memoryEnabled ? 1 : 0);
    if (patch.archived !== undefined) push('archived', patch.archived ? 1 : 0);
    if (sets.length) {
      push('updated_at', nowIso());
      await this.db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).bind(...bind, id).run();
    }
    return this.getConversation(id);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id),
      this.db.prepare('DELETE FROM conversations WHERE id = ?').bind(id),
    ]);
  }

  async touchConversation(id: string): Promise<void> {
    await this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').bind(nowIso(), id).run();
  }

  /* ------------------------------------------------------------ messages */

  private mapMessage(r: Row): ChatMessage {
    return {
      id: str(r.id),
      conversationId: str(r.conversation_id),
      role: str(r.role) as ChatMessage['role'],
      content: str(r.content),
      toolCalls: json<ChatMessage['toolCalls']>(r.tool_calls, undefined),
      toolCallId: strOrNull(r.tool_call_id) ?? undefined,
      toolName: strOrNull(r.tool_name) ?? undefined,
      attachments: json<AttachmentRef[]>(r.attachments, []),
      modelId: strOrNull(r.model_id) ?? undefined,
      providerId: (strOrNull(r.provider_id) ?? undefined) as ProviderId | undefined,
      status: (str(r.status) || 'complete') as ChatMessage['status'],
      tokensIn: r.tokens_in === null ? undefined : num(r.tokens_in),
      tokensOut: r.tokens_out === null ? undefined : num(r.tokens_out),
      error: strOrNull(r.error) ?? undefined,
      createdAt: str(r.created_at),
    };
  }

  async listMessages(conversationId: string, limit = 500): Promise<ChatMessage[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM (SELECT rowid AS _rid, * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, _rid DESC LIMIT ?) ORDER BY created_at ASC, _rid ASC')
      .bind(conversationId, limit)
      .all<Row>();
    return results.map((r) => this.mapMessage(r));
  }

  async appendMessage(msg: Omit<ChatMessage, 'createdAt'> & { createdAt?: ISODate }): Promise<ChatMessage> {
    const id = msg.id || newId('msg');
    const createdAt = msg.createdAt ?? nowIso();
    await this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tool_name,
                               attachments, model_id, provider_id, status, tokens_in, tokens_out, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, msg.conversationId, msg.role, msg.content ?? '',
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.toolCallId ?? null, msg.toolName ?? null,
        msg.attachments?.length ? JSON.stringify(msg.attachments) : null,
        msg.modelId ?? null, msg.providerId ?? null, msg.status ?? 'complete',
        msg.tokensIn ?? null, msg.tokensOut ?? null, msg.error ?? null, createdAt,
      )
      .run();
    await this.touchConversation(msg.conversationId);
    return { ...msg, id, createdAt } as ChatMessage;
  }

  async updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
    const sets: string[] = [];
    const bind: unknown[] = [];
    if (patch.content !== undefined) { sets.push('content = ?'); bind.push(patch.content); }
    if (patch.status !== undefined) { sets.push('status = ?'); bind.push(patch.status); }
    if (patch.error !== undefined) { sets.push('error = ?'); bind.push(patch.error); }
    if (patch.tokensIn !== undefined) { sets.push('tokens_in = ?'); bind.push(patch.tokensIn); }
    if (patch.tokensOut !== undefined) { sets.push('tokens_out = ?'); bind.push(patch.tokensOut); }
    if (patch.toolCalls !== undefined) { sets.push('tool_calls = ?'); bind.push(JSON.stringify(patch.toolCalls)); }
    if (!sets.length) return;
    await this.db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).bind(...bind, id).run();
  }

  async countMessages(conversationId: string): Promise<number> {
    const r = await this.db.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?').bind(conversationId).first<Row>();
    return num(r?.c);
  }

  /* ------------------------------------------------------------ projects */

  private mapProject(r: Row, stats?: ProjectStats): Project {
    return {
      id: str(r.id),
      name: str(r.name),
      description: str(r.description),
      language: str(r.language) || 'typescript',
      defaultBranch: str(r.default_branch) || 'main',
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
      stats,
    };
  }

  async listProjects(): Promise<Project[]> {
    const { results } = await this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC, rowid DESC').all<Row>();
    const out: Project[] = [];
    for (const r of results) out.push(this.mapProject(r, await this.projectStats(str(r.id))));
    return out;
  }

  async createProject(input: ProjectInput): Promise<Project> {
    const now = nowIso();
    const id = newId('prj');
    await this.db
      .prepare('INSERT INTO projects (id, name, description, language, default_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.name.trim(), input.description ?? '', input.language ?? 'typescript', 'main', now, now)
      .run();
    return { id, name: input.name.trim(), description: input.description ?? '', language: input.language ?? 'typescript', defaultBranch: 'main', createdAt: now, updatedAt: now, stats: await this.projectStats(id) };
  }

  async getProject(id: string): Promise<Project | null> {
    const r = await this.db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Row>();
    return r ? this.mapProject(r, await this.projectStats(id)) : null;
  }

  async updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project | null> {
    const sets: string[] = [];
    const bind: unknown[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); bind.push(patch.name.trim()); }
    if (patch.description !== undefined) { sets.push('description = ?'); bind.push(patch.description); }
    if (patch.language !== undefined) { sets.push('language = ?'); bind.push(patch.language); }
    if (sets.length) {
      sets.push('updated_at = ?');
      bind.push(nowIso());
      await this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...bind, id).run();
    }
    return this.getProject(id);
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM project_files WHERE project_id = ?').bind(id),
      this.db.prepare('DELETE FROM changes WHERE project_id = ?').bind(id),
      this.db.prepare('DELETE FROM commits WHERE project_id = ?').bind(id),
      this.db.prepare('DELETE FROM tasks WHERE project_id = ?').bind(id),
      this.db.prepare('DELETE FROM projects WHERE id = ?').bind(id),
    ]);
  }

  async projectStats(projectId: string): Promise<ProjectStats> {
    const r = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM project_files f WHERE f.project_id = ?1 AND f.status = 'active') AS files,
           (SELECT COUNT(*) FROM commits c WHERE c.project_id = ?1) AS commits,
           (SELECT COUNT(*) FROM changes ch WHERE ch.project_id = ?1 AND ch.status = 'pending') AS pending,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = ?1 AND t.status NOT IN ('done','cancelled')) AS tasks`,
      )
      .bind(projectId)
      .first<Row>();
    return {
      files: num(r?.files),
      commits: num(r?.commits),
      pendingChanges: num(r?.pending),
      openTasks: num(r?.tasks),
    };
  }

  /* --------------------------------------------------------------- files */

  private mapFile(r: Row): ProjectFile {
    return {
      id: str(r.id),
      projectId: str(r.project_id),
      path: str(r.path),
      content: str(r.content),
      sha: str(r.sha),
      sizeBytes: num(r.size_bytes),
      language: str(r.language),
      status: (str(r.status) || 'active') as ProjectFile['status'],
      updatedAt: str(r.updated_at),
    };
  }

  async listFiles(projectId: string): Promise<ProjectFile[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM project_files WHERE project_id = ? AND status = 'active' ORDER BY path ASC, rowid ASC")
      .bind(projectId)
      .all<Row>();
    return results.map((r) => this.mapFile(r));
  }

  async getFile(projectId: string, path: string): Promise<ProjectFile | null> {
    const r = await this.db
      .prepare("SELECT * FROM project_files WHERE project_id = ? AND path = ? AND status = 'active'")
      .bind(projectId, path)
      .first<Row>();
    return r ? this.mapFile(r) : null;
  }

  async putBlob(sha: string, content: string): Promise<void> {
    await this.db
      .prepare('INSERT INTO project_blobs (sha, content, size_bytes, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(sha) DO NOTHING')
      .bind(sha, content, new TextEncoder().encode(content).length, nowIso())
      .run();
  }

  async getBlob(sha: string): Promise<string | null> {
    const r = await this.db.prepare('SELECT content FROM project_blobs WHERE sha = ?').bind(sha).first<Row>();
    return r ? str(r.content) : null;
  }

  async putFile(projectId: string, path: string, content: string): Promise<ProjectFile> {
    const now = nowIso();
    const sha = await sha256Hex(content);
    await this.putBlob(sha, content);
    const size = new TextEncoder().encode(content).length;
    const lang = detectLanguage(path);
    const existing = await this.getFile(projectId, path);
    if (existing) {
      await this.db
        .prepare('UPDATE project_files SET content = ?, sha = ?, size_bytes = ?, language = ?, status = ?, updated_at = ? WHERE id = ?')
        .bind(content, sha, size, lang, 'active', now, existing.id)
        .run();
      return { ...existing, content, sha, sizeBytes: size, language: lang, updatedAt: now, status: 'active' };
    }
    const id = newId('file');
    await this.db
      .prepare('INSERT INTO project_files (id, project_id, path, content, sha, size_bytes, language, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, projectId, path, content, sha, size, lang, 'active', now)
      .run();
    await this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, projectId).run();
    return { id, projectId, path, content, sha, sizeBytes: size, language: lang, status: 'active', updatedAt: now };
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    await this.db
      .prepare("UPDATE project_files SET status = 'deleted', updated_at = ? WHERE project_id = ? AND path = ? AND status = 'active'")
      .bind(nowIso(), projectId, path)
      .run();
  }

  /* ------------------------------------------------------------- changes */

  private mapChange(r: Row): FileChange {
    return {
      id: str(r.id),
      projectId: str(r.project_id),
      runId: strOrNull(r.run_id),
      path: str(r.path),
      kind: str(r.kind) as FileChange['kind'],
      before: r.before_text === null ? null : str(r.before_text),
      after: r.after_text === null ? null : str(r.after_text),
      status: (str(r.status) || 'pending') as FileChange['status'],
      reason: strOrNull(r.reason) ?? undefined,
      createdAt: str(r.created_at),
      appliedAt: strOrNull(r.applied_at),
    };
  }

  async listChanges(projectId: string, status?: FileChange['status']): Promise<FileChange[]> {
    const sql = status
      ? 'SELECT * FROM changes WHERE project_id = ? AND status = ? ORDER BY created_at ASC, rowid ASC'
      : 'SELECT * FROM changes WHERE project_id = ? ORDER BY created_at ASC, rowid ASC';
    const stmt = status ? this.db.prepare(sql).bind(projectId, status) : this.db.prepare(sql).bind(projectId);
    const { results } = await stmt.all<Row>();
    return results.map((r) => this.mapChange(r));
  }

  async createChange(input: ChangeInput): Promise<FileChange> {
    const id = newId('chg');
    const now = nowIso();
    await this.db
      .prepare(
        'INSERT INTO changes (id, project_id, run_id, path, kind, before_text, after_text, status, reason, created_at, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
      )
      .bind(id, input.projectId, input.runId ?? null, input.path, input.kind, input.before, input.after, input.status ?? 'pending', input.reason ?? null, now)
      .run();
    return {
      id, projectId: input.projectId, runId: input.runId ?? null, path: input.path, kind: input.kind,
      before: input.before, after: input.after, status: input.status ?? 'pending', reason: input.reason,
      createdAt: now, appliedAt: null,
    };
  }

  async getChange(id: string): Promise<FileChange | null> {
    const r = await this.db.prepare('SELECT * FROM changes WHERE id = ?').bind(id).first<Row>();
    return r ? this.mapChange(r) : null;
  }

  async updateChange(id: string, patch: Partial<Pick<FileChange, 'status' | 'reason' | 'appliedAt'>>): Promise<void> {
    const sets: string[] = [];
    const bind: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); bind.push(patch.status); }
    if (patch.reason !== undefined) { sets.push('reason = ?'); bind.push(patch.reason); }
    if (patch.appliedAt !== undefined) { sets.push('applied_at = ?'); bind.push(patch.appliedAt); }
    if (!sets.length) return;
    await this.db.prepare(`UPDATE changes SET ${sets.join(', ')} WHERE id = ?`).bind(...bind, id).run();
  }

  /* ------------------------------------------------------------- commits */

  private mapCommit(r: Row): Commit {
    return {
      id: str(r.id),
      projectId: str(r.project_id),
      parentId: strOrNull(r.parent_id),
      message: str(r.message),
      author: str(r.author),
      branch: str(r.branch),
      tree: json<Record<string, string>>(r.tree, {}),
      stats: { files: num(r.files), additions: num(r.additions), deletions: num(r.deletions) },
      createdAt: str(r.created_at),
    };
  }

  async listCommits(projectId: string, limit = 50): Promise<Commit[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM commits WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .bind(projectId, limit)
      .all<Row>();
    return results.map((r) => this.mapCommit(r));
  }

  async createCommit(input: CommitInput): Promise<Commit> {
    const id = newId('cmt');
    const now = nowIso();
    await this.db
      .prepare(
        'INSERT INTO commits (id, project_id, parent_id, branch, message, author, tree, files, additions, deletions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        id, input.projectId, input.parentId ?? null, input.branch ?? 'main', input.message, input.author ?? 'nova',
        JSON.stringify(input.tree), input.stats.files, input.stats.additions, input.stats.deletions, now,
      )
      .run();
    return {
      id, projectId: input.projectId, parentId: input.parentId ?? null, message: input.message,
      author: input.author ?? 'nova', branch: input.branch ?? 'main', tree: input.tree,
      stats: input.stats, createdAt: now,
    };
  }

  async getCommit(projectId: string, id: string): Promise<Commit | null> {
    const r = await this.db.prepare('SELECT * FROM commits WHERE project_id = ? AND id = ?').bind(projectId, id).first<Row>();
    return r ? this.mapCommit(r) : null;
  }

  async headId(projectId: string): Promise<string | null> {
    return (await this.headCommit(projectId))?.id ?? null;
  }

  async headCommit(projectId: string): Promise<Commit | null> {
    const r = await this.db
      .prepare('SELECT * FROM commits WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .bind(projectId)
      .first<Row>();
    return r ? this.mapCommit(r) : null;
  }

  /* --------------------------------------------------------------- tasks */

  private mapTask(r: Row): Task {
    return {
      id: str(r.id),
      projectId: strOrNull(r.project_id),
      runId: strOrNull(r.run_id),
      title: str(r.title),
      detail: str(r.detail),
      status: (str(r.status) || 'pending') as Task['status'],
      order: num(r.sort_order),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    };
  }

  async listTasks(opts: { projectId?: string | null; runId?: string | null } = {}): Promise<Task[]> {
    const where: string[] = [];
    const bind: unknown[] = [];
    if (opts.projectId !== undefined) {
      if (opts.projectId === null) where.push('project_id IS NULL');
      else { where.push('project_id = ?'); bind.push(opts.projectId); }
    }
    if (opts.runId !== undefined) {
      if (opts.runId === null) where.push('run_id IS NULL');
      else { where.push('run_id = ?'); bind.push(opts.runId); }
    }
    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort_order ASC, created_at ASC, rowid ASC`;
    const { results } = await this.db.prepare(sql).bind(...bind).all<Row>();
    return results.map((r) => this.mapTask(r));
  }

  async createTask(input: { projectId?: string | null; runId?: string | null; title: string; detail?: string; status?: Task['status']; order?: number }): Promise<Task> {
    const id = newId('task');
    const now = nowIso();
    let order = input.order;
    if (order === undefined) {
      const r = await this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM tasks WHERE project_id IS ?').bind(input.projectId ?? null).first<Row>();
      order = num(r?.next, 1);
    }
    await this.db
      .prepare('INSERT INTO tasks (id, project_id, run_id, title, detail, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.projectId ?? null, input.runId ?? null, input.title, input.detail ?? '', input.status ?? 'pending', order, now, now)
      .run();
    return { id, projectId: input.projectId ?? null, runId: input.runId ?? null, title: input.title, detail: input.detail ?? '', status: input.status ?? 'pending', order, createdAt: now, updatedAt: now };
  }

  async updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'detail' | 'status' | 'order'>>): Promise<Task | null> {
    const sets: string[] = [];
    const bind: unknown[] = [];
    if (patch.title !== undefined) { sets.push('title = ?'); bind.push(patch.title); }
    if (patch.detail !== undefined) { sets.push('detail = ?'); bind.push(patch.detail); }
    if (patch.status !== undefined) { sets.push('status = ?'); bind.push(patch.status); }
    if (patch.order !== undefined) { sets.push('sort_order = ?'); bind.push(patch.order); }
    if (sets.length) {
      sets.push('updated_at = ?');
      bind.push(nowIso());
      await this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...bind, id).run();
    }
    const r = await this.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Row>();
    return r ? this.mapTask(r) : null;
  }

  async deleteTask(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  }

  /* ---------------------------------------------------------- agent runs */

  private mapRun(r: Row): AgentRun {
    return {
      id: str(r.id),
      projectId: strOrNull(r.project_id),
      conversationId: strOrNull(r.conversation_id),
      modelId: str(r.model_id),
      status: (str(r.status) || 'running') as AgentRun['status'],
      steps: num(r.steps),
      startedAt: str(r.started_at),
      finishedAt: strOrNull(r.finished_at),
      summary: strOrNull(r.summary) ?? undefined,
      error: strOrNull(r.error) ?? undefined,
    };
  }

  async createRun(input: { projectId: string | null; conversationId: string | null; modelId: string; providerId?: string; prompt: string }): Promise<AgentRun> {
    const id = newId('run');
    const now = nowIso();
    await this.db
      .prepare(
        'INSERT INTO agent_runs (id, project_id, conversation_id, model_id, provider_id, status, steps, prompt, started_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
      )
      .bind(id, input.projectId, input.conversationId, input.modelId, input.providerId ?? null, 'running', input.prompt, now)
      .run();
    return { id, projectId: input.projectId, conversationId: input.conversationId, modelId: input.modelId, status: 'running', steps: 0, startedAt: now, finishedAt: null };
  }

  async getRun(id: string): Promise<AgentRun | null> {
    const r = await this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').bind(id).first<Row>();
    return r ? this.mapRun(r) : null;
  }

  async listRuns(opts: { projectId?: string | null; limit?: number } = {}): Promise<AgentRun[]> {
    const where: string[] = [];
    const bind: unknown[] = [];
    if (opts.projectId !== undefined) {
      if (opts.projectId === null) where.push('project_id IS NULL');
      else { where.push('project_id = ?'); bind.push(opts.projectId); }
    }
    bind.push(opts.limit ?? 50);
    const sql = `SELECT * FROM agent_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC, rowid DESC LIMIT ?`;
    const { results } = await this.db.prepare(sql).bind(...bind).all<Row>();
    return results.map((r) => this.mapRun(r));
  }

  async updateRun(id: string, patch: Partial<Pick<AgentRun, 'status' | 'steps' | 'summary' | 'error' | 'finishedAt'>>): Promise<void> {
    const sets: string[] = [];
    const bind: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); bind.push(patch.status); }
    if (patch.steps !== undefined) { sets.push('steps = ?'); bind.push(patch.steps); }
    if (patch.summary !== undefined) { sets.push('summary = ?'); bind.push(patch.summary); }
    if (patch.error !== undefined) { sets.push('error = ?'); bind.push(patch.error); }
    if (patch.finishedAt !== undefined) { sets.push('finished_at = ?'); bind.push(patch.finishedAt); }
    if (!sets.length) return;
    await this.db.prepare(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = ?`).bind(...bind, id).run();
  }

  async appendRunEvent(runId: string, type: string, payload: unknown): Promise<void> {
    const r = await this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM agent_events WHERE run_id = ?').bind(runId).first<Row>();
    await this.db
      .prepare('INSERT INTO agent_events (run_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(runId, num(r?.next, 1), type, JSON.stringify(payload ?? {}), nowIso())
      .run();
  }

  async listRunEvents(runId: string) {
    const { results } = await this.db.prepare('SELECT seq, type, payload, created_at FROM agent_events WHERE run_id = ? ORDER BY seq ASC').bind(runId).all<Row>();
    return results.map((r) => ({ seq: num(r.seq), type: str(r.type), payload: json<unknown>(r.payload, {}), createdAt: str(r.created_at) }));
  }

  /* -------------------------------------------------------------- memory */

  private mapMemory(r: Row): MemoryEntry {
    return {
      id: str(r.id), scope: (str(r.scope) || 'global') as MemoryScope, scopeId: strOrNull(r.scope_id),
      key: str(r.key), content: str(r.content), createdAt: str(r.created_at), updatedAt: str(r.updated_at),
    };
  }

  async listMemory(scope: MemoryScope, scopeId: string | null = null): Promise<MemoryEntry[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM memory WHERE scope = ? AND scope_id IS ? ORDER BY key ASC')
      .bind(scope, scopeId)
      .all<Row>();
    return results.map((r) => this.mapMemory(r));
  }

  async upsertMemory(input: { scope: MemoryScope; scopeId?: string | null; key: string; content: string }): Promise<MemoryEntry> {
    const now = nowIso();
    const scopeId = input.scopeId ?? null;
    const existing = await this.db
      .prepare('SELECT * FROM memory WHERE scope = ? AND scope_id IS ? AND key = ?')
      .bind(input.scope, scopeId, input.key)
      .first<Row>();
    if (existing) {
      await this.db.prepare('UPDATE memory SET content = ?, updated_at = ? WHERE id = ?').bind(input.content, now, str(existing.id)).run();
      return this.mapMemory({ ...existing, content: input.content, updated_at: now });
    }
    const id = newId('mem');
    await this.db
      .prepare('INSERT INTO memory (id, scope, scope_id, key, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.scope, scopeId, input.key, input.content, now, now)
      .run();
    return { id, scope: input.scope, scopeId, key: input.key, content: input.content, createdAt: now, updatedAt: now };
  }

  async deleteMemory(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM memory WHERE id = ?').bind(id).run();
  }

  /* --------------------------------------------------------------- usage */

  async recordUsage(input: UsageInput): Promise<void> {
    await this.db
      .prepare('INSERT INTO usage (id, created_at, provider, model_id, kind, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('use'), nowIso(), input.provider, input.modelId, input.kind, input.tokensIn, input.tokensOut)
      .run();
  }

  async usageSummary(limit = 200) {
    const { results } = await this.db
      .prepare('SELECT * FROM usage ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .bind(limit)
      .all<Row>();
    const records: UsageRecord[] = results.map((r) => ({
      id: str(r.id), createdAt: str(r.created_at), provider: str(r.provider) as ProviderId,
      modelId: str(r.model_id), kind: (str(r.kind) || 'chat') as UsageRecord['kind'],
      tokensIn: num(r.tokens_in), tokensOut: num(r.tokens_out),
    }));
    const agg = await this.db
      .prepare('SELECT provider, SUM(tokens_in) AS ti, SUM(tokens_out) AS tog, COUNT(*) AS c FROM usage GROUP BY provider')
      .all<Row>();
    const byProvider: Record<string, { tokensIn: number; tokensOut: number; calls: number }> = {};
    let tokensIn = 0;
    let tokensOut = 0;
    for (const r of agg.results) {
      const ti = num(r.ti); const tog = num(r.tog);
      tokensIn += ti; tokensOut += tog;
      byProvider[str(r.provider)] = { tokensIn: ti, tokensOut: tog, calls: num(r.c) };
    }
    return { records, totals: { tokensIn, tokensOut, byProvider } };
  }

  /* --------------------------------------------------------- attachments */

  async createAttachment(input: AttachmentInput): Promise<AttachmentRecord> {
    const now = nowIso();
    await this.db
      .prepare(
        'INSERT INTO attachments (id, conversation_id, project_id, name, mime, size_bytes, blob_key, text_excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(input.id, input.conversationId ?? null, input.projectId ?? null, input.name, input.mime, input.sizeBytes, input.blobKey, input.textExcerpt ?? null, now)
      .run();
    return {
      id: input.id, conversationId: input.conversationId ?? null, projectId: input.projectId ?? null,
      name: input.name, mime: input.mime, size: input.sizeBytes, url: `/api/uploads/${input.id}`,
      blobKey: input.blobKey, text: input.textExcerpt ?? undefined, textExcerpt: input.textExcerpt ?? null,
      createdAt: now,
    };
  }

  async getAttachment(id: string): Promise<AttachmentRecord | null> {
    const r = await this.db.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<Row>();
    if (!r) return null;
    return {
      id: str(r.id), conversationId: strOrNull(r.conversation_id), projectId: strOrNull(r.project_id),
      name: str(r.name), mime: str(r.mime), size: num(r.size_bytes), url: `/api/uploads/${str(r.id)}`,
      blobKey: str(r.blob_key), text: strOrNull(r.text_excerpt) ?? undefined,
      textExcerpt: strOrNull(r.text_excerpt), createdAt: str(r.created_at),
    };
  }

  /* ------------------------------------------------------------ settings */

  async getSettings(): Promise<AppSettings> {
    const r = await this.db.prepare("SELECT value FROM settings WHERE key = 'app'").first<Row>();
    if (!r) return structuredClone(DEFAULT_SETTINGS);
    return { ...structuredClone(DEFAULT_SETTINGS), ...json<Partial<AppSettings>>(r.value, {}) } as AppSettings;
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const next: AppSettings = {
      ...current,
      ...patch,
      defaults: { ...current.defaults, ...(patch.defaults ?? {}) } as Record<ModelClass, string | null>,
      agent: { ...current.agent, ...(patch.agent ?? {}) },
    };
    await this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind('app', JSON.stringify(next))
      .run();
    return next;
  }

  /* ------------------------------------------------------------- catalog */

  async cacheModels(models: ModelInfo[]): Promise<void> {
    const stmts = models.map((m) =>
      this.db
        .prepare(
          'INSERT INTO catalog_cache (model_id, provider, data, verified_at) VALUES (?, ?, ?, ?) ON CONFLICT(model_id) DO UPDATE SET data = excluded.data, verified_at = excluded.verified_at',
        )
        .bind(m.id, m.provider, JSON.stringify(m), m.verifiedAt ?? nowIso().slice(0, 10)),
    );
    if (stmts.length) await this.db.batch(stmts);
  }

  async cachedModels(provider?: string): Promise<ModelInfo[]> {
    const sql = provider ? 'SELECT data FROM catalog_cache WHERE provider = ?' : 'SELECT data FROM catalog_cache';
    const stmt = provider ? this.db.prepare(sql).bind(provider) : this.db.prepare(sql);
    const { results } = await stmt.all<Row>();
    return results.map((r) => json<ModelInfo>(r.data, null as unknown as ModelInfo)).filter(Boolean);
  }
}
