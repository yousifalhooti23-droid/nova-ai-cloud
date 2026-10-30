import { diff, toUnifiedDiff, nowIso, newId } from '@nova/shared';
import type { Commit, FileChange, ProjectFile } from '@nova/shared';
import type { Store } from '../storage/types.js';

/**
 * Nova VCS — a snapshot-based Git-compatible layer over D1.
 *
 * What it really is (no overclaiming):
 *   • Every commit stores the full path → sha tree of the project.
 *   • Diffs/stats are computed against the parent tree with the shared Myers diff.
 *   • Branch = a label on the commit chain (single branch per project in the MVP).
 *   • There is no `git` binary here; the Worker runtime has no shell.
 *     Real `git` commands run through the sandbox (`run_command`), and pushing to
 *     a real remote is done by the GitHub adapter below.
 */
export class GitService {
  constructor(private store: Store) {}

  async status(projectId: string) {
    const head = await this.store.headCommit(projectId);
    const pending = await this.store.listChanges(projectId, 'pending');
    const files = await this.store.listFiles(projectId);
    const headTree = head?.tree ?? {};
    const working = new Map(files.map((f) => [f.path, f.sha]));
    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    for (const [path, sha] of working) {
      if (!(path in headTree)) added.push(path);
      else if (headTree[path] !== sha) modified.push(path);
    }
    for (const path of Object.keys(headTree)) if (!working.has(path)) deleted.push(path);
    return {
      branch: head?.branch ?? 'main',
      head: head ? { id: head.id, message: head.message, createdAt: head.createdAt, author: head.author } : null,
      workingTree: { added: added.sort(), modified: modified.sort(), deleted: deleted.sort(), clean: added.length + modified.length + deleted.length === 0 },
      pendingProposals: pending.map((c) => ({ id: c.id, path: c.path, kind: c.kind, reason: c.reason ?? null })),
      fileCount: files.length,
    };
  }

  async commit(projectId: string, message: string, author = 'nova-agent'): Promise<Commit> {
    if (!message.trim()) throw new Error('commit message is required');
    const files = await this.store.listFiles(projectId);
    const parent = await this.store.headCommit(projectId);
    const tree: Record<string, string> = {};
    for (const f of files) tree[f.path] = f.sha;

    const parentTree = parent?.tree ?? {};
    let additions = 0;
    let deletions = 0;
    let changedFiles = 0;
    const paths = new Set([...Object.keys(tree), ...Object.keys(parentTree)]);
    const byPath = new Map(files.map((f) => [f.path, f]));
    for (const path of paths) {
      const before = parentTree[path];
      const after = tree[path];
      if (before === after) continue;
      changedFiles++;
      const oldText = before ? (await this.fileAtCommit(parent!, path)) ?? '' : '';
      const newText = after ? byPath.get(path)?.content ?? '' : '';
      const d = diff(oldText, newText);
      additions += d.additions;
      deletions += d.deletions;
    }
    if (changedFiles === 0 && parent) {
      throw new Error('nothing to commit: working tree matches HEAD');
    }
    return this.store.createCommit({
      projectId,
      parentId: parent?.id ?? null,
      message: message.trim(),
      author,
      branch: parent?.branch ?? 'main',
      tree,
      stats: { files: changedFiles, additions, deletions },
    });
  }

  /** Content of a path at a given commit — exact, because blobs are content-addressed. */
  async fileAtCommit(commit: Commit, path: string): Promise<string | null> {
    const sha = commit.tree[path];
    if (!sha) return null;
    return this.store.getBlob(sha);
  }

  async log(projectId: string, limit = 25): Promise<Commit[]> {
    return this.store.listCommits(projectId, limit);
  }

  private async blobOf(sha: string): Promise<string | null> {
    return this.store.getBlob(sha);
  }

  /** Content of a path at a specific commit — used by the "restore file" action. */
  async contentAtCommit(projectId: string, commitId: string, path: string): Promise<string | null> {
    const commit = await this.store.getCommit(projectId, commitId);
    if (!commit) return null;
    return this.fileAtCommit(commit, path);
  }

  /** Unified diff between a commit and its parent (or the working tree). */
  async show(projectId: string, commitId: string): Promise<{ commit: Commit; files: { path: string; patch: string; additions: number; deletions: number }[] }> {
    const commit = await this.store.getCommit(projectId, commitId);
    if (!commit) throw new Error(`commit ${commitId} not found`);
    const parent = commit.parentId ? await this.store.getCommit(projectId, commit.parentId) : null;
    const parentTree = parent?.tree ?? {};
    const files = await this.store.listFiles(projectId);
    const byPath = new Map(files.map((f) => [f.path, f]));
    const paths = new Set([...Object.keys(commit.tree), ...Object.keys(parentTree)]);
    const out: { path: string; patch: string; additions: number; deletions: number }[] = [];
    for (const path of [...paths].sort()) {
      if (commit.tree[path] === parentTree[path]) continue;
      const newText = commit.tree[path] ? (await this.blobOf(commit.tree[path])) ?? byPath.get(path)?.content ?? '' : '';
      const before = parentTree[path] ? (await this.blobOf(parentTree[path])) ?? '' : '';
      const patch = toUnifiedDiff(before, newText, path);
      const d = diff(before, newText);
      out.push({ path, patch, additions: d.additions, deletions: d.deletions });
    }
    return { commit, files: out };
  }

  /** Working-tree diff for a single path (used by the Diff panel). */
  async diffPath(projectId: string, path: string): Promise<{ patch: string; additions: number; deletions: number; before: string; after: string }> {
    const head = await this.store.headCommit(projectId);
    const file = await this.store.getFile(projectId, path);
    const before = head?.tree[path] ? (await this.blobOf(head.tree[path])) ?? '' : '';
    const after = file?.content ?? '';
    const d = diff(before, after);
    return { patch: toUnifiedDiff(before, after, path), additions: d.additions, deletions: d.deletions, before, after };
  }
}

/**
 * Optional GitHub sync via the REST Contents API.
 * Requires GITHUB_TOKEN + a repo ("owner/name"). Without them it fails with an
 * explicit error — it never claims success.
 */
export class GitHubSync {
  constructor(
    private store: Store,
    private opts: { token?: string; repo?: string; baseUrl?: string },
  ) {}

  get configured(): boolean {
    return Boolean(this.opts.token && this.opts.repo);
  }

  status(): { configured: boolean; detail: string } {
    if (this.configured) return { configured: true, detail: `Pushing to github.com/${this.opts.repo} (token stored server-side only).` };
    return {
      configured: false,
      detail: 'GitHub sync is not configured. Set GITHUB_TOKEN and GITHUB_REPO (owner/name) in .dev.vars. The token never leaves the Worker.',
    };
  }

  /** Push a set of file changes to the default branch using the Contents API. */
  async pushFiles(projectId: string, changes: FileChange[], message: string): Promise<{ pushed: number; skipped: number; errors: { path: string; error: string }[]; commitUrl?: string }> {
    if (!this.configured) throw new Error('GitHub sync is not configured (GITHUB_TOKEN / GITHUB_REPO missing).');
    const base = (this.opts.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
    const repo = this.opts.repo!;
    const errors: { path: string; error: string }[] = [];
    let pushed = 0;
    let skipped = 0;
    let lastSha: string | undefined;

    // Resolve branch head sha once (needed to update existing files).
    let branchSha: string | undefined;
    try {
      const ref = await this.call(`${base}/repos/${repo}/git/ref/heads/main`, 'GET');
      branchSha = (ref as any)?.object?.sha;
    } catch {
      branchSha = undefined; // empty repo or different default branch
    }

    for (const c of changes) {
      try {
        if (c.status !== 'applied') {
          skipped++;
          continue;
        }
        const path = c.path;
        const url = `${base}/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
        if (c.kind === 'delete') {
          const existing = (await this.call(url, 'GET')) as any;
          if (!existing?.sha) {
            skipped++;
            continue;
          }
          await this.call(url, 'DELETE', { message, sha: existing.sha, branch: 'main' });
        } else {
          const file = await this.store.getFile(projectId, path);
          if (!file) {
            skipped++;
            continue;
          }
          const existing = (await this.call(url, 'GET').catch(() => null)) as any;
          await this.call(url, 'PUT', {
            message,
            content: btoa(unescape(encodeURIComponent(file.content))),
            branch: 'main',
            ...(existing?.sha ? { sha: existing.sha } : {}),
          });
        }
        pushed++;
      } catch (err) {
        errors.push({ path: c.path, error: err instanceof Error ? err.message : String(err) });
      }
    }
    void lastSha;
    void branchSha;
    return { pushed, skipped, errors, commitUrl: `https://github.com/${repo}/commits/main` };
  }

  private async call(url: string, method: string, body?: unknown): Promise<unknown> {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'nova-ai-cloud',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    if (!res.ok && !(method === 'GET' && res.status === 404)) {
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  static newId = newId;
  static nowIso = nowIso;
}

export type { ProjectFile };
