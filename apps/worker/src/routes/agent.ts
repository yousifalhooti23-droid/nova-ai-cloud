import type { AgentRunDetailResponse, AgentRunRequest, AgentRunsResponse } from '@nova/shared';
import { diff, toUnifiedDiff, truncate } from '@nova/shared';
import type { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { runAgent } from '../agent/loop.js';
import { badRequest, describeError, notFound } from '../lib/errors.js';
import { sseResponse } from '../lib/sse.js';

export function registerAgentRoutes(app: Hono<AppEnv>) {
  /**
   * POST /api/agent/run — start a coding agent run. Streams every step:
   * thoughts, tool calls, tool results, proposed diffs, task updates.
   * The HTTP request itself is the run: closing it aborts the loop.
   */
  app.post('/api/agent/run', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => null)) as AgentRunRequest | null;
    if (!req) throw badRequest('JSON body is required', 'bad_body');
    if (!req.projectId) throw badRequest('projectId is required', 'missing_project');
    if (!req.prompt?.trim()) throw badRequest('prompt is required', 'missing_prompt');
    const project = await d.store.getProject(req.projectId);
    if (!project) throw notFound(`project ${req.projectId} not found`);
    if (req.prompt.length > 100_000) throw badRequest('prompt is too long', 'too_long');

    const settings = await d.store.getSettings();
    const autoApply = req.autoApply ?? settings.agent.autoApply;
    const allowTerminal = req.allowTerminal ?? settings.agent.allowTerminal;
    const maxSteps = Math.min(req.maxSteps ?? settings.agent.maxSteps ?? 12, 30);

    return sseResponse(async (emit, signal) => {
      try {
        await runAgent(
          { store: d.store, router: d.router, sandbox: d.sandbox, cfg: d.cfg, log: d.log },
          {
            projectId: req.projectId,
            conversationId: req.conversationId ?? null,
            prompt: req.prompt,
            modelId: req.modelId,
            modelClass: req.modelClass ?? 'coding',
            maxSteps,
            autoApply,
            allowTerminal,
          },
          emit,
          signal,
        );
      } catch (err) {
        const { message, code } = describeError(err);
        emit({ type: 'error', message: truncate(message, 2000), code });
      }
    });
  });

  app.get('/api/agent/runs', async (c) => {
    const d = c.get('deps');
    const projectId = c.req.query('projectId');
    const runs = await d.store.listRuns({ projectId: projectId ?? undefined, limit: Number(c.req.query('limit') ?? 30) });
    const body: AgentRunsResponse = { runs };
    return c.json(body);
  });

  /** Full replay of a run: events, proposals and tasks (used when reopening a project). */
  app.get('/api/agent/runs/:id', async (c) => {
    const d = c.get('deps');
    const run = await d.store.getRun(c.req.param('id'));
    if (!run) throw notFound('run not found');
    const [events, changes, tasks] = await Promise.all([
      d.store.listRunEvents(run.id),
      d.store.listChanges(run.projectId ?? ''),
      d.store.listTasks({ runId: run.id }),
    ]);
    const body: AgentRunDetailResponse & { diffs: Record<string, { additions: number; deletions: number; patch: string }> } = {
      run,
      events,
      changes,
      tasks,
      diffs: Object.fromEntries(
        changes.map((ch) => {
          const dt = diff(ch.before ?? '', ch.after ?? '');
          return [ch.id, { additions: dt.additions, deletions: dt.deletions, patch: truncate(patchOf(ch), 20000) }];
        }),
      ),
    };
    return c.json(body);
  });
}

function patchOf(ch: { before: string | null; after: string | null; path: string }): string {
  return toUnifiedDiff(ch.before ?? '', ch.after ?? '', ch.path);
}
