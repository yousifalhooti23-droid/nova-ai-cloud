import type {
  ApplyAllResponse, ChangeActionRequest, ChangesResponse, CommitRequest, CommitsResponse, FileListResponse,
  FileResponse, FileWriteRequest, ProjectCreateRequest, ProjectListResponse, SearchRequest, SearchResponse,
} from '@nova/shared';
import { detectLanguage, diff, hasTraversal, isBinaryPath, normalizePath, toUnifiedDiff, truncate } from '@nova/shared';
import type { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { GitHubSync } from '../agent/git.js';
import { applyChange } from '../agent/tools/files.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/** Path handling shared by every project-file route. */
function safePath(raw: string | null | undefined): string {
  if (!raw) throw badRequest('path query parameter is required', 'missing_path');
  if (hasTraversal(raw)) throw badRequest('path traversal is not allowed', 'bad_path');
  const p = normalizePath(raw);
  if (!p) throw badRequest('path is required', 'bad_path');
  if (p.length > 400) throw badRequest('path is too long', 'bad_path');
  return p;
}

export function registerProjectRoutes(app: Hono<AppEnv>) {
  /* ------------------------------------------------------------- projects */

  app.get('/api/projects', async (c) => {
    const d = c.get('deps');
    const body: ProjectListResponse = { projects: await d.store.listProjects() };
    return c.json(body);
  });

  app.post('/api/projects', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as ProjectCreateRequest;
    if (!req.name?.trim()) throw badRequest('name is required', 'missing_name');
    if (req.name.length > 120) throw badRequest('name is too long', 'bad_name');
    const project = await d.store.createProject({
      name: req.name.trim(),
      description: req.description?.slice(0, 2000) ?? '',
      language: req.language ?? 'typescript',
    });
    // Optional seed files — real files, not demo content unless the caller sends it.
    for (const [rawPath, content] of Object.entries(req.files ?? {})) {
      if (hasTraversal(rawPath)) throw badRequest(`invalid seed path: ${rawPath}`, 'bad_path');
      const path = normalizePath(rawPath);
      if (!path || typeof content !== 'string') continue;
      await d.store.putFile(project.id, path, content);
    }
    const files = await d.store.listFiles(project.id);
    if (files.length) {
      await d.git.commit(project.id, 'chore: initial project scaffold', 'nova');
    }
    return c.json({ project: await d.store.getProject(project.id) }, 201);
  });

  app.get('/api/projects/:id', async (c) => {
    const d = c.get('deps');
    const project = await d.store.getProject(c.req.param('id'));
    if (!project) throw notFound('project not found');
    const [files, changes, commits, tasks, status] = await Promise.all([
      d.store.listFiles(project.id),
      d.store.listChanges(project.id, 'pending'),
      d.store.listCommits(project.id, 20),
      d.store.listTasks({ projectId: project.id }),
      d.git.status(project.id),
    ]);
    return c.json({
      project,
      files: files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes, sha: f.sha, language: f.language, updatedAt: f.updatedAt })),
      pendingChanges: changes.map((ch) => ({ ...ch, additions: diff(ch.before ?? '', ch.after ?? '').additions, deletions: diff(ch.before ?? '', ch.after ?? '').deletions })),
      commits,
      tasks,
      git: status,
      github: githubSync(d).status(),
    });
  });

  app.patch('/api/projects/:id', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as Partial<ProjectCreateRequest>;
    const project = await d.store.updateProject(c.req.param('id'), { name: req.name, description: req.description, language: req.language });
    if (!project) throw notFound('project not found');
    return c.json({ project });
  });

  app.delete('/api/projects/:id', async (c) => {
    const d = c.get('deps');
    const project = await d.store.getProject(c.req.param('id'));
    if (!project) throw notFound('project not found');
    await d.store.deleteProject(project.id);
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------------- files */

  app.get('/api/projects/:id/files', async (c) => {
    const d = c.get('deps');
    const files = await d.store.listFiles(c.req.param('id'));
    const body: FileListResponse = {
      files: files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes, sha: f.sha, language: f.language, updatedAt: f.updatedAt })),
    };
    return c.json(body);
  });

  app.get('/api/projects/:id/file', async (c) => {
    const d = c.get('deps');
    const path = safePath(c.req.query('path'));
    const file = await d.store.getFile(c.req.param('id'), path);
    if (!file) throw notFound(`file not found: ${path}`);
    const body: FileResponse = { file };
    return c.json(body);
  });

  /** Direct user edit from the code editor (not an agent proposal). */
  app.put('/api/projects/:id/file', async (c) => {
    const d = c.get('deps');
    const projectId = c.req.param('id');
    if (!(await d.store.getProject(projectId))) throw notFound('project not found');
    const req = (await c.req.json().catch(() => null)) as FileWriteRequest | null;
    if (!req) throw badRequest('JSON body is required', 'bad_body');
    const path = safePath(req.path);
    if (isBinaryPath(path)) throw badRequest('binary files cannot be edited as text', 'binary_file');
    if (typeof req.content !== 'string') throw badRequest('content must be a string', 'bad_content');
    if (req.content.length > 2_000_000) throw badRequest('content is too large (max 2MB)', 'too_large');

    const existing = await d.store.getFile(projectId, path);
    if (req.expectedSha && existing && existing.sha !== req.expectedSha) {
      throw conflict('file changed since you loaded it (sha mismatch). Reload before saving.', 'sha_conflict');
    }
    const file = await d.store.putFile(projectId, path, req.content);
    let commitId: string | null = null;
    if (req.commitMessage?.trim()) {
      const commit = await d.git.commit(projectId, req.commitMessage.trim(), 'user');
      commitId = commit.id;
    }
    return c.json({ file, commitId, language: detectLanguage(path) });
  });

  app.delete('/api/projects/:id/file', async (c) => {
    const d = c.get('deps');
    const projectId = c.req.param('id');
    const path = safePath(c.req.query('path'));
    const file = await d.store.getFile(projectId, path);
    if (!file) throw notFound(`file not found: ${path}`);
    await d.store.deleteFile(projectId, path);
    return c.json({ ok: true, path });
  });

  /* --------------------------------------------------------------- search */

  app.post('/api/projects/:id/search', async (c) => {
    const d = c.get('deps');
    const projectId = c.req.param('id');
    const req = (await c.req.json().catch(() => ({}))) as SearchRequest;
    if (!req.query?.trim()) throw badRequest('query is required', 'missing_query');
    const mode = req.mode ?? 'all';
    const flags = req.caseSensitive ? 'g' : 'gi';
    let re: RegExp;
    try {
      re = new RegExp(req.regex ? req.query : req.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (err) {
      throw badRequest(`invalid regex: ${err instanceof Error ? err.message : String(err)}`, 'bad_regex');
    }
    const limit = Math.min(500, req.limit ?? 100);
    const files = await d.store.listFiles(projectId);
    const hits: SearchResponse['hits'] = [];
    for (const f of files) {
      if (isBinaryPath(f.path)) continue;
      if (mode !== 'content' && f.path.toLowerCase().includes(req.query.toLowerCase())) {
        hits.push({ path: f.path, line: 0, text: '(filename match)', score: 3 });
      }
      if (mode === 'name') continue;
      const lines = f.content.split('\n');
      for (let i = 0; i < lines.length && hits.length < limit * 3; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i])) hits.push({ path: f.path, line: i + 1, text: truncate(lines[i].trim(), 200), score: 1 });
      }
      if (hits.length >= limit * 3) break;
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
    const body: SearchResponse = { hits: hits.slice(0, limit), scannedFiles: files.length, truncated: hits.length > limit };
    return c.json(body);
  });

  /* -------------------------------------------------------------- changes */

  app.get('/api/projects/:id/changes', async (c) => {
    const d = c.get('deps');
    const status = c.req.query('status') as 'pending' | 'applied' | 'rejected' | undefined;
    const changes = await d.store.listChanges(c.req.param('id'), status);
    const body: ChangesResponse = {
      changes: changes.map((ch) => {
        const dt = diff(ch.before ?? '', ch.after ?? '');
        return { ...ch, additions: dt.additions, deletions: dt.deletions };
      }),
    };
    return c.json(body);
  });

  /** Approve (apply) or reject a single proposal. */
  app.post('/api/changes/:changeId', async (c) => {
    const d = c.get('deps');
    const change = await d.store.getChange(c.req.param('changeId'));
    if (!change) throw notFound('change not found');
    const req = (await c.req.json().catch(() => ({}))) as ChangeActionRequest;
    if (req.action !== 'apply' && req.action !== 'reject') throw badRequest('action must be "apply" or "reject"', 'bad_action');
    if (change.status !== 'pending') throw conflict(`change is already ${change.status}`, 'not_pending');

    if (req.action === 'reject') {
      await d.store.updateChange(change.id, { status: 'rejected', appliedAt: new Date().toISOString() });
      return c.json({ change: await d.store.getChange(change.id) });
    }
    await applyChange({ store: d.store, projectId: change.projectId }, change);
    const updated = await d.store.getChange(change.id);
    return c.json({ change: updated, diff: toUnifiedDiff(change.before ?? '', change.after ?? '', change.path) });
  });

  /** Apply or reject every pending proposal at once, then optionally commit. */
  app.post('/api/projects/:id/changes/apply-all', async (c) => {
    const d = c.get('deps');
    const projectId = c.req.param('id');
    const req = (await c.req.json().catch(() => ({}))) as { action?: 'apply' | 'reject'; commitMessage?: string };
    const action = req.action ?? 'apply';
    const pending = await d.store.listChanges(projectId, 'pending');
    let applied = 0;
    let rejected = 0;
    for (const ch of pending) {
      if (action === 'apply') {
        await applyChange({ store: d.store, projectId }, ch);
        applied++;
      } else {
        await d.store.updateChange(ch.id, { status: 'rejected', appliedAt: new Date().toISOString() });
        rejected++;
      }
    }
    let commitId: string | null = null;
    if (action === 'apply' && applied > 0) {
      const message = req.commitMessage?.trim() || `chore: apply ${applied} approved change(s)`;
      try {
        commitId = (await d.git.commit(projectId, message, 'user')).id;
      } catch {
        commitId = null; // nothing changed relative to HEAD
      }
    }
    const body: ApplyAllResponse = { applied, rejected, commitId };
    return c.json(body);
  });

  /* ----------------------------------------------------------------- git */

  app.get('/api/projects/:id/git/status', async (c) => {
    const d = c.get('deps');
    return c.json(await d.git.status(c.req.param('id')));
  });

  app.get('/api/projects/:id/commits', async (c) => {
    const d = c.get('deps');
    const body: CommitsResponse = { commits: await d.store.listCommits(c.req.param('id'), Number(c.req.query('limit') ?? 50)) };
    return c.json(body);
  });

  app.post('/api/projects/:id/commits', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as CommitRequest;
    if (!req.message?.trim()) throw badRequest('message is required', 'missing_message');
    try {
      const commit = await d.git.commit(c.req.param('id'), req.message.trim(), req.author ?? 'user');
      return c.json({ commit }, 201);
    } catch (err) {
      throw conflict(err instanceof Error ? err.message : String(err), 'commit_failed');
    }
  });

  app.get('/api/projects/:id/commits/:commitId', async (c) => {
    const d = c.get('deps');
    const shown = await d.git.show(c.req.param('id'), c.req.param('commitId'));
    return c.json(shown);
  });

  app.get('/api/projects/:id/diff', async (c) => {
    const d = c.get('deps');
    const path = safePath(c.req.query('path'));
    return c.json(await d.git.diffPath(c.req.param('id'), path));
  });

  /** Optional GitHub push (needs GITHUB_TOKEN + GITHUB_REPO server-side). */
  app.post('/api/projects/:id/git/push', async (c) => {
    const d = c.get('deps');
    const projectId = c.req.param('id');
    const sync = githubSync(d);
    if (!sync.configured) {
      return c.json({ ok: false, ...sync.status(), hint: 'Set GITHUB_TOKEN and GITHUB_REPO in .dev.vars. The token is never sent to the browser.' }, 503);
    }
    const req = (await c.req.json().catch(() => ({}))) as { message?: string; changeIds?: string[] };
    const all = await d.store.listChanges(projectId);
    const changes = req.changeIds?.length ? all.filter((ch) => req.changeIds!.includes(ch.id)) : all;
    const result = await sync.pushFiles(projectId, changes, req.message?.trim() || 'chore: sync from NOVA AI Cloud');
    return c.json({ ok: result.errors.length === 0, ...result });
  });
}

function githubSync(d: { env: Record<string, unknown>; store: import('../storage/types.js').Store }) {
  const env = d.env as Record<string, unknown>;
  return new GitHubSync(d.store, {
    token: typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN : undefined,
    repo: typeof env.GITHUB_REPO === 'string' ? env.GITHUB_REPO : undefined,
    baseUrl: typeof env.GITHUB_BASE_URL === 'string' ? env.GITHUB_BASE_URL : undefined,
  });
}
