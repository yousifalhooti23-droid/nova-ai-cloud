import { create } from 'zustand';
import type { Commit, FileChange, MemoryEntry, ModelClass, Project, ServerEvent, Task } from '@nova/shared';
import { isBinaryPath } from '@nova/shared';
import type { SearchResponse } from '@nova/shared';
import { api, describeApiError, type GitStatusResponse } from '@/lib/api';
import { streamRequest, type StreamHandle } from '@/lib/sse';

export interface FileSummary {
  path: string;
  sizeBytes: number;
  sha: string;
  language: string;
  updatedAt: string;
}

export interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  sha: string;
  language: string;
  binary: boolean;
  saving: boolean;
}

export interface AgentEventItem {
  seq: number;
  at: string;
  event: ServerEvent;
}

export interface AgentState {
  running: boolean;
  runId: string | null;
  status: string | null;
  step: number;
  modelId: string | null;
  provider: string | null;
  events: AgentEventItem[];
  summary: string | null;
  error: string | null;
  prompt: string;
  maxSteps: number;
  autoApply: boolean;
  allowTerminal: boolean;
  modelIdOverride: string | null;
  modelClass: ModelClass;
}

export interface TerminalEntry {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  adapter: string;
  ok: boolean;
  error?: string;
  running?: boolean;
  at: string;
}

let agentHandle: StreamHandle | null = null;
let seq = 0;
let termSeq = 0;

export const initialAgent: AgentState = {
  running: false,
  runId: null,
  status: null,
  step: 0,
  modelId: null,
  provider: null,
  events: [],
  summary: null,
  error: null,
  prompt: '',
  maxSteps: 12,
  autoApply: false,
  allowTerminal: false,
  modelIdOverride: null,
  modelClass: 'coding',
};

interface CodeState {
  projects: Project[];
  activeProjectId: string | null;
  files: FileSummary[];
  openFiles: Record<string, OpenFile>;
  activePath: string | null;
  changes: (FileChange & { additions: number; deletions: number })[];
  tasks: Task[];
  commits: Commit[];
  git: GitStatusResponse | null;
  memory: MemoryEntry[];
  search: { query: string; running: boolean; result: SearchResponse | null };
  terminal: TerminalEntry[];
  agent: AgentState;
  loading: boolean;
  lastError: { message: string; hint?: string } | null;

  loadProjects: () => Promise<void>;
  createProject: (name: string, description?: string, files?: Record<string, string>) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  selectProject: (id: string | null) => Promise<void>;
  refreshProject: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActivePath: (path: string | null) => void;
  editFile: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<boolean>;
  createFile: (path: string, content?: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  runSearch: (query: string, mode?: 'name' | 'content' | 'all') => Promise<void>;
  clearSearch: () => void;
  loadChanges: () => Promise<void>;
  decideChange: (changeId: string, action: 'apply' | 'reject') => Promise<void>;
  decideAll: (action: 'apply' | 'reject', commitMessage?: string) => Promise<number>;
  loadTasks: () => Promise<void>;
  patchTask: (id: string, patch: Partial<Pick<Task, 'title' | 'detail' | 'status'>>) => Promise<void>;
  loadGit: () => Promise<void>;
  commitAll: (message: string) => Promise<string | null>;
  pushGithub: (message?: string) => Promise<{ ok: boolean; detail?: string }>;
  loadMemory: (scopeId?: string | null) => Promise<void>;
  saveMemory: (key: string, content: string) => Promise<boolean>;
  runAgent: (prompt: string) => Promise<void>;
  stopAgent: () => void;
  setAgent: (patch: Partial<AgentState>) => void;
  clearAgent: () => void;
  runCommand: (command: string) => Promise<void>;
  clearTerminal: () => void;
  refreshCommits: () => Promise<void>;
  reloadOpenFiles: () => Promise<void>;
}

export const useCodeStore = create<CodeState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  files: [],
  openFiles: {},
  activePath: null,
  changes: [],
  tasks: [],
  commits: [],
  git: null,
  memory: [],
  search: { query: '', running: false, result: null },
  terminal: [],
  agent: initialAgent,
  loading: false,
  lastError: null,

  async loadProjects() {
    try {
      const { projects } = await api.listProjects();
      set({ projects, lastError: null });
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async createProject(name, description, files) {
    try {
      const { project } = await api.createProject({ name: name.trim(), description: description ?? '', files });
      set((s) => ({ projects: [project, ...s.projects], lastError: null }));
      await get().selectProject(project.id);
      return project;
    } catch (err) {
      set({ lastError: describeApiError(err) });
      return null;
    }
  },

  async deleteProject(id) {
    try {
      await api.deleteProject(id);
    } catch (err) {
      set({ lastError: describeApiError(err) });
      return;
    }
    const remaining = get().projects.filter((p) => p.id !== id);
    set({ projects: remaining });
    if (get().activeProjectId === id) {
      await get().selectProject(remaining[0]?.id ?? null);
    }
  },

  async selectProject(id) {
    set({
      activeProjectId: id,
      files: [],
      openFiles: {},
      activePath: null,
      changes: [],
      tasks: [],
      commits: [],
      git: null,
      memory: [],
      terminal: [],
      search: { query: '', running: false, result: null },
      agent: initialAgent,
      lastError: null,
    });
    if (!id) return;
    await get().refreshProject();
  },

  async refreshProject() {
    const id = get().activeProjectId;
    if (!id) return;
    set({ loading: true });
    try {
      const [filesRes, changes, tasks, commits, git] = await Promise.all([
        api.listFiles(id),
        api.listChanges(id),
        api.listTasks(id),
        api.commits(id, 50),
        api.gitStatus(id),
      ]);
      set({
        files: filesRes.files,
        changes: changes.changes,
        tasks: tasks.tasks,
        commits: commits.commits,
        git,
        loading: false,
        lastError: null,
      });
    } catch (err) {
      set({ loading: false, lastError: describeApiError(err) });
    }
  },

  async openFile(path) {
    const id = get().activeProjectId;
    if (!id) return;
    const already = get().openFiles[path];
    set({ activePath: path });
    if (already) return;
    if (isBinaryPath(path)) {
      set((s) => ({
        openFiles: {
          ...s.openFiles,
          [path]: { path, content: '', savedContent: '', sha: '', language: 'binary', binary: true, saving: false },
        },
      }));
      return;
    }
    try {
      const res = await api.readFile(id, path);
      set((s) => ({
        openFiles: {
          ...s.openFiles,
          [path]: {
            path,
            content: res.file.content,
            savedContent: res.file.content,
            sha: res.file.sha,
            language: res.language ?? res.file.language,
            binary: false,
            saving: false,
          },
        },
      }));
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  closeFile(path) {
    set((s) => {
      const openFiles = { ...s.openFiles };
      delete openFiles[path];
      const remaining = Object.keys(openFiles);
      return {
        openFiles,
        activePath: s.activePath === path ? (remaining[remaining.length - 1] ?? null) : s.activePath,
      };
    });
  },

  setActivePath(path) {
    set({ activePath: path });
  },

  editFile(path, content) {
    set((s) => {
      const file = s.openFiles[path];
      if (!file) return {};
      return { openFiles: { ...s.openFiles, [path]: { ...file, content } } };
    });
  },

  async saveFile(path) {
    const id = get().activeProjectId;
    const file = get().openFiles[path];
    if (!id || !file || file.binary) return false;
    set((s) => ({ openFiles: { ...s.openFiles, [path]: { ...s.openFiles[path], saving: true } } }));
    try {
      const res = await api.writeFile(id, { path, content: file.content, expectedSha: file.sha || null });
      set((s) => ({
        openFiles: {
          ...s.openFiles,
          [path]: { ...s.openFiles[path], savedContent: res.file.content, sha: res.file.sha, saving: false },
        },
        files: s.files.map((f) =>
          f.path === path ? { ...f, sha: res.file.sha, sizeBytes: res.file.sizeBytes, updatedAt: res.file.updatedAt } : f,
        ),
      }));
      void get().loadGit();
      return true;
    } catch (err) {
      set((s) => ({ openFiles: { ...s.openFiles, [path]: { ...s.openFiles[path], saving: false } }, lastError: describeApiError(err) }));
      return false;
    }
  },

  async createFile(path, content = '') {
    const id = get().activeProjectId;
    if (!id) return;
    try {
      const res = await api.writeFile(id, { path, content });
      set((s) => ({
        files: s.files.some((f) => f.path === path)
          ? s.files
          : [...s.files, { path, sizeBytes: res.file.sizeBytes, sha: res.file.sha, language: res.file.language, updatedAt: res.file.updatedAt }].sort(
              (a, b) => a.path.localeCompare(b.path),
            ),
      }));
      await get().openFile(path);
      void get().loadGit();
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async deleteFile(path) {
    const id = get().activeProjectId;
    if (!id) return;
    try {
      await api.deleteFile(id, path);
      get().closeFile(path);
      set((s) => ({ files: s.files.filter((f) => f.path !== path) }));
      void get().loadGit();
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async runSearch(query, mode = 'all') {
    const id = get().activeProjectId;
    if (!id || !query.trim()) {
      set({ search: { query, running: false, result: null } });
      return;
    }
    set({ search: { query, running: true, result: get().search.result } });
    try {
      const result = await api.search(id, { query: query.trim(), mode, limit: 200 });
      set({ search: { query, running: false, result } });
    } catch (err) {
      set({ search: { query, running: false, result: null }, lastError: describeApiError(err) });
    }
  },

  clearSearch() {
    set({ search: { query: '', running: false, result: null } });
  },

  async loadChanges() {
    const id = get().activeProjectId;
    if (!id) return;
    try {
      const { changes } = await api.listChanges(id);
      set({ changes });
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async decideChange(changeId, action) {
    try {
      await api.actOnChange(changeId, { action });
      await Promise.all([get().loadChanges(), get().loadGit()]);
      const changed = get().changes.find((c) => c.id === changeId);
      if (action === 'apply' && changed) {
        // Reflect the applied content in the editor if that file is open.
        const open = get().openFiles[changed.path];
        if (open) await get().openFile(changed.path);
      }
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async decideAll(action, commitMessage) {
    const id = get().activeProjectId;
    if (!id) return 0;
    try {
      const res = await api.applyAll(id, { action, commitMessage });
      await Promise.all([get().loadChanges(), get().loadGit(), get().refreshCommits(), get().reloadOpenFiles()]);
      return action === 'apply' ? res.applied : res.rejected;
    } catch (err) {
      set({ lastError: describeApiError(err) });
      return 0;
    }
  },

  async loadTasks() {
    const id = get().activeProjectId;
    if (!id) return;
    try {
      const { tasks } = await api.listTasks(id);
      set({ tasks });
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async patchTask(id, patch) {
    try {
      const { task } = await api.patchTask(id, patch);
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === task.id ? task : t)) }));
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async loadGit() {
    const id = get().activeProjectId;
    if (!id) return;
    try {
      const [git, commitsRes] = await Promise.all([api.gitStatus(id), api.commits(id, 50)]);
      set({ git, commits: commitsRes.commits });
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async commitAll(message) {
    const id = get().activeProjectId;
    if (!id) return null;
    try {
      const { commit } = await api.commit(id, { message });
      await get().loadGit();
      return commit.id;
    } catch (err) {
      set({ lastError: describeApiError(err) });
      return null;
    }
  },

  async pushGithub(message) {
    const id = get().activeProjectId;
    if (!id) return { ok: false };
    try {
      const res = await api.pushGithub(id, message ? { message } : undefined);
      return { ok: Boolean(res.ok), detail: res.detail ?? res.hint ?? (res.ok ? undefined : 'push failed') };
    } catch (err) {
      const d = describeApiError(err);
      return { ok: false, detail: d.hint ?? d.message };
    }
  },

  async loadMemory(scopeId) {
    try {
      const { entries } = await api.listMemory('project', scopeId ?? get().activeProjectId);
      set({ memory: entries });
    } catch {
      set({ memory: [] });
    }
  },

  async saveMemory(key, content) {
    const scopeId = get().activeProjectId;
    if (!scopeId) return false;
    try {
      await api.createMemory({ scope: 'project', scopeId, key, content });
      await get().loadMemory(scopeId);
      return true;
    } catch (err) {
      set({ lastError: describeApiError(err) });
      return false;
    }
  },

  async runAgent(prompt) {
    const id = get().activeProjectId;
    const text = prompt.trim();
    if (!id || !text || get().agent.running) return;
    const a = get().agent;
    set({
      agent: {
        ...a,
        running: true,
        runId: null,
        status: 'running',
        step: 0,
        events: [],
        summary: null,
        error: null,
        prompt: text,
      },
      lastError: null,
    });

    const { url, init } = api.agentBody({
      projectId: id,
      prompt: text,
      modelId: a.modelIdOverride,
      modelClass: a.modelClass,
      maxSteps: a.maxSteps,
      autoApply: a.autoApply,
      allowTerminal: a.allowTerminal,
    });

    agentHandle = streamRequest(url, init, (evt) => {
      seq += 1;
      set((s) => ({ agent: { ...s.agent, events: [...s.agent.events, { seq, at: new Date().toISOString(), event: evt }].slice(-400) } }));
      switch (evt.type) {
        case 'agent.start':
          set((s) => ({ agent: { ...s.agent, runId: evt.runId, modelId: evt.modelId, provider: evt.provider, status: 'running' } }));
          break;
        case 'agent.status':
          set((s) => ({ agent: { ...s.agent, status: evt.status, step: evt.step } }));
          break;
        case 'agent.done':
          set((s) => ({ agent: { ...s.agent, running: false, status: evt.run.status, summary: evt.summary, error: evt.run.error ?? null } }));
          break;
        case 'error':
          set((s) => ({ agent: { ...s.agent, running: false, error: evt.message, status: s.agent.status ?? 'failed' } }));
          break;
        default:
          break;
      }
    });

    const result = await agentHandle.done;
    agentHandle = null;
    set((s) => ({ agent: { ...s.agent, running: false } }));
    if (!result.ok && result.error && result.error !== 'aborted') {
      set((s) => ({ agent: { ...s.agent, error: s.agent.error ?? result.error ?? 'stream_failed' } }));
    }
    await Promise.all([get().loadChanges(), get().loadTasks(), get().loadGit(), get().reloadOpenFiles()]);
  },

  stopAgent() {
    agentHandle?.abort();
    agentHandle = null;
    set((s) => ({ agent: { ...s.agent, running: false, status: 'cancelled' } }));
  },

  setAgent(patch) {
    set((s) => ({ agent: { ...s.agent, ...patch } }));
  },

  clearAgent() {
    set({ agent: { ...initialAgent, prompt: get().agent.prompt } });
  },

  async runCommand(command) {
    const id = get().activeProjectId;
    const cmd = command.trim();
    if (!cmd) return;
    const entryId = `term-${++termSeq}`;
    set((s) => ({
      terminal: [
        ...s.terminal,
        { id: entryId, command: cmd, stdout: '', stderr: '', exitCode: null, durationMs: 0, adapter: '', ok: false, running: true, at: new Date().toISOString() },
      ],
    }));
    try {
      const res = await api.sandboxExec({ command: cmd, projectId: id ?? undefined, language: 'shell', timeoutMs: 30_000 });
      set((s) => ({
        terminal: s.terminal.map((e) =>
          e.id === entryId
            ? { ...e, running: false, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode, durationMs: res.durationMs, adapter: res.adapter, ok: res.ok, error: res.error }
            : e,
        ),
      }));
    } catch (err) {
      const d = describeApiError(err);
      set((s) => ({
        terminal: s.terminal.map((e) =>
          e.id === entryId ? { ...e, running: false, ok: false, error: d.hint ?? d.message, adapter: 'refused' } : e,
        ),
      }));
    }
  },

  clearTerminal() {
    set({ terminal: [] });
  },

  /* helpers that need a fresh read of several slices */
  async refreshCommits() {
    const id = get().activeProjectId;
    if (!id) return;
    try {
      const { commits } = await api.commits(id, 50);
      set({ commits });
    } catch {
      /* non-fatal */
    }
  },

  async reloadOpenFiles() {
    const id = get().activeProjectId;
    if (!id) return;
    const paths = Object.keys(get().openFiles).filter((p) => !get().openFiles[p].binary);
    for (const path of paths) {
      const open = get().openFiles[path];
      if (open && open.content !== open.savedContent) continue; // keep user edits
      try {
        const res = await api.readFile(id, path);
        set((s) => ({
          openFiles: {
            ...s.openFiles,
            [path]: { path, content: res.file.content, savedContent: res.file.content, sha: res.file.sha, language: res.language ?? res.file.language, binary: false, saving: false },
          },
        }));
      } catch {
        /* file may have been deleted by the agent */
      }
    }
  },
}));
