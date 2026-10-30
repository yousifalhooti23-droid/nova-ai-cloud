import { detectLanguage, dirOf, hasTraversal, isBinaryPath, normalizePath, truncate } from '@nova/shared';
import { diff, toUnifiedDiff, applyEdit } from '@nova/shared';
import type { FileChange } from '@nova/shared';
import type { Tool, ToolContext, ToolResult } from './types.js';
import { boolArg, checkPath, fail, numArg, ok, reqStr, strArg } from './types.js';

/* --------------------------------------------------------------- read_file */

export const readFileTool: Tool = {
  descriptor: {
    name: 'read_file',
    description:
      'Read a text file from the current project. Returns the content with 1-based line numbers so you can reference exact lines in edits. Use startLine/endLine for large files.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative path, e.g. "src/app.ts"' },
        startLine: { type: 'integer', description: 'First line to return (1-based, optional)' },
        endLine: { type: 'integer', description: 'Last line to return (inclusive, optional)' },
      },
      required: ['path'],
    },
  },
  async run(args, ctx) {
    const p = reqStr(args, 'path');
    if (!p.ok) return fail(p.error);
    const chk = checkPath(p.value);
    if (!chk.ok) return fail(chk.error!);
    let file = await ctx.store.getFile(ctx.projectId, chk.path!);
    let pendingNotice = '';
    if (!file) {
      // A proposal for this path may be awaiting approval: show it, clearly labelled,
      // so the agent can reason about its own pending work instead of hallucinating.
      const pending = (await ctx.store.listChanges(ctx.projectId, 'pending')).filter((ch) => ch.path === chk.path);
      const latest = pending[pending.length - 1];
      if (latest && latest.kind !== 'delete') {
        file = {
          id: latest.id,
          projectId: ctx.projectId,
          path: latest.path,
          content: latest.after ?? '',
          sha: 'pending',
          sizeBytes: (latest.after ?? '').length,
          language: detectLanguage(latest.path),
          status: 'active',
          updatedAt: latest.createdAt,
        };
        pendingNotice = `[PENDING PROPOSAL ${latest.id} — NOT applied to the project yet; the user must approve it]\n`;
      }
    }
    if (!file) return fail(`file not found: ${chk.path}. Call list_files to see the project tree.`);
    if (isBinaryPath(file.path)) return fail(`${file.path} looks binary; this tool only reads text files.`);

    const lines = file.content.split('\n');
    const start = Math.max(1, numArg(args, 'startLine', 1));
    const end = Math.min(lines.length, numArg(args, 'endLine', lines.length));
    const slice = lines.slice(start - 1, end);
    const width = String(end).length;
    const numbered = slice.map((l, i) => `${String(start + i).padStart(width, ' ')}| ${l}`).join('\n');
    return ok(`${pendingNotice}${numbered}` || '(empty file)', {
      path: file.path,
      language: file.language,
      sha: file.sha,
      totalLines: lines.length,
      returnedLines: slice.length,
      sizeBytes: file.sizeBytes,
      pending: pendingNotice !== '',
    });
  },
};

/* -------------------------------------------------------------- list_files */

export const listFilesTool: Tool = {
  descriptor: {
    name: 'list_files',
    description: 'List the project files as a tree (paths, sizes). Use it first to orient yourself in an unknown project.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional sub-directory filter, e.g. "src"' },
        includeContentPreview: { type: 'boolean', description: 'Include the first line of each file (default false)' },
      },
    },
  },
  async run(args, ctx) {
    const files = await ctx.store.listFiles(ctx.projectId);
    const sub = normalizePath(strArg(args, 'path') ?? '');
    const filtered = sub ? files.filter((f) => f.path.startsWith(`${sub}/`) || f.path === sub) : files;
    if (filtered.length === 0) {
      return ok(
        files.length === 0
          ? 'The project has no files yet. Use write_file to create the first one.'
          : `No files under "${sub}". Root contains: ${files.slice(0, 40).map((f) => f.path).join(', ')}`,
        { count: 0 },
      );
    }
    const preview = boolArg(args, 'includeContentPreview', false);
    const lines: string[] = filtered.map((f) => `${f.path}  (${f.sizeBytes}B)`);
    if (preview) {
      const extra: string[] = [];
      for (const f of filtered.slice(0, 20)) {
        const first = f.content.split('\n').find((l) => l.trim()) ?? '';
        extra.push(`${f.path}: ${truncate(first, 80)}`);
      }
      lines.push('', '--- first lines ---', ...extra);
    }
    return ok(lines.join('\n'), { count: filtered.length, totalBytes: filtered.reduce((s, f) => s + f.sizeBytes, 0) });
  },
};

/* ---------------------------------------------------------- search_project */

export const searchProjectTool: Tool = {
  descriptor: {
    name: 'search_project',
    description:
      'Search the project by file name and/or content. Returns matching paths with line numbers and a relevance score. Use it to find where a symbol is defined or used before editing.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex to find' },
        mode: { type: 'string', enum: ['name', 'content', 'all'], description: 'Where to search (default "all")' },
        caseSensitive: { type: 'boolean', description: 'Default false' },
        regex: { type: 'boolean', description: 'Treat query as a regular expression (default false)' },
        limit: { type: 'integer', description: 'Maximum hits to return (default 40)' },
      },
      required: ['query'],
    },
  },
  async run(args, ctx) {
    const q = reqStr(args, 'query');
    if (!q.ok) return fail(q.error);
    const mode = (strArg(args, 'mode') ?? 'all') as 'name' | 'content' | 'all';
    const caseSensitive = boolArg(args, 'caseSensitive', false);
    const useRegex = boolArg(args, 'regex', false);
    const limit = Math.min(200, numArg(args, 'limit', 40));

    let re: RegExp;
    try {
      re = new RegExp(useRegex ? q.value : escapeRegExp(q.value), caseSensitive ? 'g' : 'gi');
    } catch (err) {
      return fail(`invalid regex: ${err instanceof Error ? err.message : String(err)}`);
    }

    const files = await ctx.store.listFiles(ctx.projectId);
    const hits: { path: string; line: number; text: string; score: number }[] = [];
    for (const f of files) {
      if (isBinaryPath(f.path)) continue;
      if (mode !== 'content') {
        const nameScore = f.path.toLowerCase().includes(q.value.toLowerCase()) ? 3 : 0;
        if (nameScore > 0) hits.push({ path: f.path, line: 0, text: '(filename match)', score: nameScore });
      }
      if (mode !== 'name' && hits.length < limit * 4) {
        const lines = f.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0;
          if (re.test(lines[i])) {
            hits.push({ path: f.path, line: i + 1, text: truncate(lines[i].trim(), 180), score: 1 });
            if (hits.length >= limit * 4) break;
          }
        }
      }
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
    const out = hits.slice(0, limit);
    if (out.length === 0) return ok(`No matches for "${q.value}" across ${files.length} files.`, { hits: 0, scannedFiles: files.length });
    const text = out.map((h) => `${h.path}${h.line ? `:${h.line}` : ''}: ${h.text}`).join('\n');
    return ok(text, { hits: out.length, scannedFiles: files.length, truncated: hits.length > limit });
  },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------- proposed mutations */

async function propose(
  ctx: ToolContext,
  input: { path: string; kind: FileChange['kind']; before: string | null; after: string | null; reason?: string },
): Promise<ToolResult> {
  const change = await ctx.store.createChange({
    projectId: ctx.projectId,
    runId: ctx.runId,
    path: input.path,
    kind: input.kind,
    before: input.before,
    after: input.after,
    reason: input.reason,
    status: ctx.autoApply ? 'applied' : 'pending',
  });

  if (ctx.autoApply) {
    await applyChange(ctx, change);
  } else {
    const d = diff(input.before ?? '', input.after ?? '');
    ctx.emit({
      type: 'agent.change.proposed',
      runId: ctx.runId,
      change,
      diff: d.hunks,
      additions: d.additions,
      deletions: d.deletions,
    });
    await ctx.recordEvent('change.proposed', { changeId: change.id, path: change.path, kind: change.kind });
  }

  const patch = toUnifiedDiff(input.before ?? '', input.after ?? '', input.path);
  const summary =
    input.kind === 'delete'
      ? `Proposed deletion of ${input.path}`
      : `Proposed ${input.kind} for ${input.path}`;
  return ok(
    [
      `${summary} (${ctx.autoApply ? 'AUTO-APPLIED — user enabled autoApply for this run' : 'PENDING USER APPROVAL — not written to the project yet'}).`,
      patch ? `\`\`\`diff\n${truncate(patch, 6000)}\n\`\`\`` : '(no textual difference)',
      ctx.autoApply ? '' : 'The user must approve this change in the Diff panel before it becomes part of the project.',
    ]
      .filter(Boolean)
      .join('\n'),
    { changeId: change.id, path: input.path, kind: input.kind, autoApplied: ctx.autoApply },
  );
}

export async function applyChange(ctx: Pick<ToolContext, 'store' | 'projectId'>, change: FileChange): Promise<void> {
  if (change.kind === 'delete') await ctx.store.deleteFile(ctx.projectId, change.path);
  else await ctx.store.putFile(ctx.projectId, change.path, change.after ?? '');
  await ctx.store.updateChange(change.id, { status: 'applied', appliedAt: new Date().toISOString() });
}

/* -------------------------------------------------------------- write_file */

export const writeFileTool: Tool = {
  descriptor: {
    name: 'write_file',
    description:
      'Create a new file or fully replace an existing one. The write is recorded as a CHANGE PROPOSAL with a diff; it is only applied after the user approves it (unless the user enabled autoApply). Prefer edit_file for small changes.',
    risk: 'proposal',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative path, e.g. "src/utils/date.ts"' },
        content: { type: 'string', description: 'Full file content' },
        reason: { type: 'string', description: 'One sentence explaining why this change is needed' },
      },
      required: ['path', 'content'],
    },
  },
  async run(args, ctx) {
    const p = reqStr(args, 'path');
    if (!p.ok) return fail(p.error);
    const chk = checkPath(p.value, { write: true });
    if (!chk.ok) return fail(chk.error!);
    const content = strArg(args, 'content');
    if (content === undefined) return fail('missing required argument "content"');
    if (content.length > 400_000) return fail('content is too large (max 400,000 characters)');

    const existing = await ctx.store.getFile(ctx.projectId, chk.path!);
    if (existing && existing.content === content) return ok(`No change needed: ${chk.path} already has exactly this content.`, { path: chk.path });
    return propose(ctx, {
      path: chk.path!,
      kind: existing ? 'update' : 'create',
      before: existing?.content ?? null,
      after: content,
      reason: strArg(args, 'reason'),
    });
  },
};

/* -------------------------------------------------------------- edit_file */

export const editFileTool: Tool = {
  descriptor: {
    name: 'edit_file',
    description:
      'Replace an exact snippet inside an existing file (surgical edit). "search" must match the file byte-for-byte including indentation, and must be unique unless replaceAll is true. Produces a change proposal with a diff for user approval.',
    risk: 'proposal',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        search: { type: 'string', description: 'Exact text to find (include enough context to be unique)' },
        replace: { type: 'string', description: 'Text to put in its place' },
        replaceAll: { type: 'boolean', description: 'Replace every occurrence (default false)' },
        reason: { type: 'string' },
      },
      required: ['path', 'search', 'replace'],
    },
  },
  async run(args, ctx) {
    const p = reqStr(args, 'path');
    if (!p.ok) return fail(p.error);
    const chk = checkPath(p.value, { write: true });
    if (!chk.ok) return fail(chk.error!);
    const search = strArg(args, 'search');
    const replace = strArg(args, 'replace');
    if (search === undefined || replace === undefined) return fail('both "search" and "replace" are required');
    const file = await ctx.store.getFile(ctx.projectId, chk.path!);
    if (!file) return fail(`file not found: ${chk.path}. Use write_file to create it, or list_files to see what exists.`);

    const res = applyEdit(file.content, search, replace, { replaceAll: boolArg(args, 'replaceAll', false) });
    if (!res.ok) {
      const hint = res.occurrences === 0 ? suggestSimilar(file.content, search) : occurrenceLines(file.content, search);
      return fail(`${res.error}.${hint ? ` ${hint}` : ''}`, { occurrences: res.occurrences });
    }
    if (res.text === file.content) return ok(`Edit produced no change in ${file.path}.`, { path: file.path });
    return propose(ctx, {
      path: file.path,
      kind: 'update',
      before: file.content,
      after: res.text,
      reason: strArg(args, 'reason') ?? `edit_file (${res.replacements} replacement${res.replacements === 1 ? '' : 's'})`,
    });
  },
};

/** Show every occurrence with its line number so the model can disambiguate precisely. */
function occurrenceLines(content: string, search: string): string {
  const lines = content.split('\n');
  const needle = search.split('\n')[0];
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (needle && lines[i].includes(needle)) hits.push(`line ${i + 1}: ${lines[i].trim().slice(0, 100)}`);
  }
  return hits.length
    ? `Occurrences → ${hits.join(' | ')}. Include neighbouring lines to make "search" unique.`
    : 'Add more surrounding lines to make "search" unique.';
}

function suggestSimilar(content: string, search: string): string {
  const first = search.split('\n')[0]?.trim();
  if (!first) return '';
  const lines = content.split('\n');
  const hits: string[] = [];
  for (let i = 0; i < lines.length && hits.length < 3; i++) {
    if (lines[i].includes(first.slice(0, Math.max(8, first.length - 6)))) hits.push(`${i + 1}: ${lines[i].trim().slice(0, 120)}`);
  }
  return hits.length ? `Closest lines in the file → ${hits.join(' | ')}` : 'The snippet may differ in whitespace; read_file the exact region first.';
}

/* ------------------------------------------------------------ delete_file */

export const deleteFileTool: Tool = {
  descriptor: {
    name: 'delete_file',
    description: 'Propose deleting a file. Requires user approval like any other change.',
    risk: 'proposal',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['path'],
    },
  },
  async run(args, ctx) {
    const p = reqStr(args, 'path');
    if (!p.ok) return fail(p.error);
    const chk = checkPath(p.value, { write: true });
    if (!chk.ok) return fail(chk.error!);
    const file = await ctx.store.getFile(ctx.projectId, chk.path!);
    if (!file) return fail(`file not found: ${chk.path}`);
    return propose(ctx, { path: file.path, kind: 'delete', before: file.content, after: null, reason: strArg(args, 'reason') });
  },
};

export const fileTools: Tool[] = [readFileTool, listFilesTool, searchProjectTool, writeFileTool, editFileTool, deleteFileTool];
export { hasTraversal, dirOf, detectLanguage };
