import type { Task } from '@nova/shared';
import type { Tool } from './types.js';
import { fail, numArg, ok, reqStr, strArg } from './types.js';

/**
 * Task planner: complex requests are decomposed into ordered, checkable steps.
 * Tasks are persisted, streamed to the UI, and the agent is instructed to keep
 * their status current — that is what makes long jobs auditable.
 */
export const planTasksTool: Tool = {
  descriptor: {
    name: 'plan_tasks',
    description:
      'Break the current request into an ordered task list and persist it. Call this FIRST for any multi-step job (more than one file or more than one concern). Each task must be small enough to verify on its own.',
    risk: 'proposal',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Ordered steps',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Imperative, <= 90 chars, e.g. "Add rate-limit middleware to /api/chat"' },
              detail: { type: 'string', description: 'Acceptance criteria / how to verify' },
            },
            required: ['title'],
          },
        },
        replace: { type: 'boolean', description: 'Cancel the existing plan for this run (default false = append)' },
      },
      required: ['tasks'],
    },
  },
  async run(args, ctx) {
    const raw = args.tasks;
    if (!Array.isArray(raw) || raw.length === 0) return fail('"tasks" must be a non-empty array');
    if (raw.length > 25) return fail('too many tasks at once (max 25) — plan the next batch after finishing this one');

    if (args.replace) {
      for (const t of await ctx.store.listTasks({ runId: ctx.runId })) {
        if (t.status !== 'done') await ctx.store.updateTask(t.id, { status: 'cancelled' });
      }
    }
    const existing = (await ctx.store.listTasks({ runId: ctx.runId })).length;
    const created: Task[] = [];
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i] as Record<string, unknown>;
      const title = strArg(item, 'title');
      if (!title) {
        return fail(`tasks[${i}] is missing "title"`);
      }
      created.push(
        await ctx.store.createTask({
          projectId: ctx.projectId,
          runId: ctx.runId,
          title: title.slice(0, 200),
          detail: (strArg(item, 'detail') ?? '').slice(0, 2000),
          order: existing + i + 1,
        }),
      );
    }
    const all = await ctx.store.listTasks({ projectId: ctx.projectId });
    ctx.emit({ type: 'agent.tasks.updated', runId: ctx.runId, tasks: all });
    await ctx.recordEvent('tasks.planned', { ids: created.map((t) => t.id) });
    return ok(
      `Plan saved (${created.length} tasks):\n${created.map((t, i) => `${i + 1}. [${t.id}] ${t.title}${t.detail ? ` — ${t.detail}` : ''}`).join('\n')}\nUpdate each task's status with update_task as you work.`,
      { taskIds: created.map((t) => t.id) },
    );
  },
};

export const updateTaskTool: Tool = {
  descriptor: {
    name: 'update_task',
    description: 'Set a task status. Use "done" only after the work is verifiably complete (verified with verify_code or a passing command).',
    risk: 'proposal',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked', 'cancelled'] },
        note: { type: 'string', description: 'Appended to the task detail (e.g. why it is blocked)' },
      },
      required: ['taskId', 'status'],
    },
  },
  async run(args, ctx) {
    const id = reqStr(args, 'taskId');
    if (!id.ok) return fail(id.error);
    const status = strArg(args, 'status') as Task['status'] | undefined;
    if (!status) return fail('status is required');
    const task = await ctx.store.updateTask(id.value, { status });
    if (!task) return fail(`task not found: ${id.value}`);
    const note = strArg(args, 'note');
    if (note) await ctx.store.updateTask(id.value, { detail: `${task.detail ? task.detail + '\n' : ''}[${status}] ${note}`.slice(0, 2000) });
    const all = await ctx.store.listTasks({ projectId: ctx.projectId });
    ctx.emit({ type: 'agent.tasks.updated', runId: ctx.runId, tasks: all });
    return ok(`Task ${task.id} → ${status}${note ? ` (${note})` : ''}`, { taskId: task.id, status });
  },
};

export const planningTools: Tool[] = [planTasksTool, updateTaskTool];
void numArg;
