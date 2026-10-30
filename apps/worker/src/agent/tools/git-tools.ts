import { truncate } from '@nova/shared';
import type { Tool } from './types.js';
import { fail, numArg, ok, reqStr, strArg } from './types.js';

export const gitStatusTool: Tool = {
  descriptor: {
    name: 'git_status',
    description: 'Show repository state: branch, HEAD commit, working-tree changes vs HEAD, and change proposals awaiting user approval.',
    risk: 'read-only',
    parameters: { type: 'object', properties: {} },
  },
  async run(_args, ctx) {
    const s = await ctx.git.status(ctx.projectId);
    const lines = [
      `branch: ${s.branch}`,
      `HEAD: ${s.head ? `${s.head.id} — ${s.head.message} (${s.head.createdAt})` : '(no commits yet)'}`,
      `files tracked: ${s.fileCount}`,
      '',
      'working tree vs HEAD:',
      s.workingTree.clean
        ? '  clean'
        : [
            ...s.workingTree.added.map((p) => `  A ${p}`),
            ...s.workingTree.modified.map((p) => `  M ${p}`),
            ...s.workingTree.deleted.map((p) => `  D ${p}`),
          ].join('\n'),
      '',
      `proposals awaiting approval: ${s.pendingProposals.length}`,
      ...s.pendingProposals.slice(0, 30).map((p) => `  [${p.kind}] ${p.path}${p.reason ? ` — ${p.reason}` : ''}`),
    ];
    return ok(lines.join('\n'), { clean: s.workingTree.clean, pending: s.pendingProposals.length, head: s.head?.id ?? null });
  },
};

export const gitCommitTool: Tool = {
  descriptor: {
    name: 'git_commit',
    description:
      'Commit the current applied project state as a snapshot. Only files that were actually applied (approved changes or direct edits) are included. Fails when nothing changed since HEAD.',
    risk: 'needs-approval',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Conventional commit message, e.g. "feat(api): add rate limiting"' },
        author: { type: 'string', description: 'Optional author name (default "nova-agent")' },
      },
      required: ['message'],
    },
  },
  async run(args, ctx) {
    const m = reqStr(args, 'message');
    if (!m.ok) return fail(m.error);
    const status = await ctx.git.status(ctx.projectId);
    if (status.pendingProposals.length > 0) {
      return fail(
        `${status.pendingProposals.length} change proposal(s) are still awaiting user approval. Committing now would produce a commit that does not match what the user has seen. Ask the user to approve them first, then commit.`,
        { pending: status.pendingProposals.map((p) => p.path) },
      );
    }
    try {
      const commit = await ctx.git.commit(ctx.projectId, m.value, strArg(args, 'author') ?? 'nova-agent');
      return ok(
        `Committed ${commit.id}\nmessage: ${commit.message}\nfiles: ${commit.stats.files}, +${commit.stats.additions} −${commit.stats.deletions}`,
        { commitId: commit.id, stats: commit.stats },
      );
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
};

export const gitDiffTool: Tool = {
  descriptor: {
    name: 'git_diff',
    description: 'Show a unified diff. Either the working tree vs HEAD (optionally for one path), or a specific commit vs its parent.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Restrict to one file' },
        commitId: { type: 'string', description: 'Show this commit instead of the working tree' },
        limit: { type: 'integer', description: 'Max characters to return (default 8000)' },
      },
    },
  },
  async run(args, ctx) {
    const limit = numArg(args, 'limit', 8000);
    const commitId = strArg(args, 'commitId');
    if (commitId) {
      const shown = await ctx.git.show(ctx.projectId, commitId);
      const body = shown.files.map((f) => `### ${f.path}  (+${f.additions} −${f.deletions})\n\`\`\`diff\n${f.patch}\n\`\`\``).join('\n\n');
      return ok(`commit ${shown.commit.id} — ${shown.commit.message}\n\n${truncate(body || '(no file differences)', limit)}`, { files: shown.files.length });
    }
    const path = strArg(args, 'path');
    if (path) {
      const d = await ctx.git.diffPath(ctx.projectId, path);
      if (!d.patch) return ok(`No differences for ${path} (working tree matches HEAD).`, { path });
      return ok(`\`\`\`diff\n${truncate(d.patch, limit)}\n\`\`\``, { path, additions: d.additions, deletions: d.deletions });
    }
    const status = await ctx.git.status(ctx.projectId);
    const paths = [...status.workingTree.added, ...status.workingTree.modified, ...status.workingTree.deleted];
    if (paths.length === 0) return ok('Working tree is clean relative to HEAD.', { files: 0 });
    const parts: string[] = [];
    for (const p of paths.slice(0, 10)) {
      const d = await ctx.git.diffPath(ctx.projectId, p);
      parts.push(`### ${p} (+${d.additions} −${d.deletions})\n\`\`\`diff\n${truncate(d.patch, 2000)}\n\`\`\``);
    }
    return ok(truncate(parts.join('\n\n'), limit), { files: paths.length, shown: Math.min(paths.length, 10) });
  },
};

export const gitLogTool: Tool = {
  descriptor: {
    name: 'git_log',
    description: 'List recent commits (newest first) with their stats.',
    risk: 'read-only',
    parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Default 15' } } },
  },
  async run(args, ctx) {
    const commits = await ctx.git.log(ctx.projectId, Math.min(50, numArg(args, 'limit', 15)));
    if (commits.length === 0) return ok('No commits yet. Files are stored but unversioned until you call git_commit.', { count: 0 });
    const text = commits
      .map((c) => `${c.id}  ${c.createdAt}  ${c.author}  ${c.message}  [${c.stats.files} files, +${c.stats.additions} −${c.stats.deletions}]`)
      .join('\n');
    return ok(text, { count: commits.length });
  },
};

export const gitTools: Tool[] = [gitStatusTool, gitCommitTool, gitDiffTool, gitLogTool];
