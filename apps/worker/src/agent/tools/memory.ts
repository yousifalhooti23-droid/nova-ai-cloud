import { truncate } from '@nova/shared';
import type { Tool } from './types.js';
import { fail, ok, reqStr } from './types.js';

/**
 * Project-scoped memory.
 * Global memory and per-project memory are separate stores, so facts about one
 * project never leak into another project's context.
 */
export const readMemoryTool: Tool = {
  descriptor: {
    name: 'read_memory',
    description:
      'Read stored memory for THIS project (plus global preferences). Call it at the start of a session to recall conventions, architecture decisions and known pitfalls.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Optional exact key filter' } },
    },
  },
  async run(args, ctx) {
    const key = args.key ? reqStr(args, 'key') : null;
    if (key && !key.ok) return fail(key.error);
    const project = await ctx.store.listMemory('project', ctx.projectId);
    const global = await ctx.store.listMemory('global', null);
    const filter = (rows: typeof project) => (key ? rows.filter((r) => r.key === key.value) : rows);
    const p = filter(project);
    const g = filter(global);
    if (p.length === 0 && g.length === 0) {
      return ok('No memory stored yet for this project. Use write_memory to persist conventions, decisions and pitfalls you discover.', { project: 0, global: 0 });
    }
    const render = (title: string, rows: typeof project) =>
      rows.length ? `${title}:\n${rows.map((r) => `  • ${r.key}: ${truncate(r.content, 500)}`).join('\n')}` : '';
    return ok([render(`project memory (${p.length})`, p), render(`global memory (${g.length})`, g)].filter(Boolean).join('\n\n'), {
      project: p.length,
      global: g.length,
    });
  },
};

export const writeMemoryTool: Tool = {
  descriptor: {
    name: 'write_memory',
    description:
      'Persist a durable fact. Scope "project" (default) applies only to the current project; scope "global" applies to every project — use global only for user preferences, never for project specifics.',
    risk: 'proposal',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short stable identifier, e.g. "test-command" or "api-conventions"' },
        content: { type: 'string', description: 'The fact, <= 1000 chars' },
        scope: { type: 'string', enum: ['project', 'global'], description: 'Default "project"' },
      },
      required: ['key', 'content'],
    },
  },
  async run(args, ctx) {
    const key = reqStr(args, 'key');
    if (!key.ok) return fail(key.error);
    const content = reqStr(args, 'content');
    if (!content.ok) return fail(content.error);
    const scope = (args.scope === 'global' ? 'global' : 'project') as 'global' | 'project';
    const entry = await ctx.store.upsertMemory({
      scope,
      scopeId: scope === 'project' ? ctx.projectId : null,
      key: key.value.slice(0, 120),
      content: content.value.slice(0, 1000),
    });
    await ctx.recordEvent('memory.written', { id: entry.id, scope, key: entry.key });
    return ok(`Stored ${scope} memory "${entry.key}".`, { id: entry.id, scope });
  },
};

export const memoryTools: Tool[] = [readMemoryTool, writeMemoryTool];
