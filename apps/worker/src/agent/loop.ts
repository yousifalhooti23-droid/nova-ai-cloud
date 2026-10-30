import type { ModelClass, ServerEvent, ToolCallRequest } from '@nova/shared';
import { newId, truncate } from '@nova/shared';
import type { NovaConfig } from '../env.js';
import { HttpError, describeError } from '../lib/errors.js';
import type { Logger } from '../lib/log.js';
import type { ModelRouter } from '../ai/router.js';
import type { SandboxAdapter } from '../sandbox/types.js';
import type { Store } from '../storage/types.js';
import { GitService } from './git.js';
import { buildAgentSystemPrompt } from './prompts.js';
import { TOOL_MAP, toolSpecs } from './tools/index.js';
import type { ChatTurn } from '../ai/types.js';
import type { ToolContext, ToolResult } from './tools/types.js';

export interface AgentDeps {
  store: Store;
  router: ModelRouter;
  sandbox: SandboxAdapter;
  cfg: NovaConfig;
  log: Logger;
}

export interface AgentRunInput {
  projectId: string;
  conversationId?: string | null;
  prompt: string;
  modelId?: string | null;
  modelClass?: ModelClass;
  maxSteps?: number;
  autoApply?: boolean;
  allowTerminal?: boolean;
  systemPromptExtra?: string;
  /** Restrict the exposed tool set (e.g. read-only chat mode). */
  toolNames?: string[];
}

export interface AgentRunOutcome {
  runId: string;
  status: 'completed' | 'awaiting_approval' | 'failed';
  summary: string;
  steps: number;
  toolCalls: number;
  proposedChanges: string[];
  modelId: string;
}

const MAX_TOOL_RESULT_CHARS = 12_000;
const HISTORY_TURNS = 8;

/**
 * The agent loop.
 *
 * Shape: a bounded tool-calling loop (plan → act → observe) where every
 * mutating tool produces a *proposal* instead of writing to the project.
 * The run ends in `awaiting_approval` whenever proposals are pending, which the
 * UI turns into the diff/approval panel.
 */
export async function runAgent(
  deps: AgentDeps,
  input: AgentRunInput,
  emit: (evt: ServerEvent) => void,
  signal?: AbortSignal,
): Promise<AgentRunOutcome> {
  const { store, router, cfg, log } = deps;
  const git = new GitService(store);

  // Resolve once so the whole run uses one model (and one bill).
  const resolution = await router.resolve({
    modelId: input.modelId,
    modelClass: input.modelClass ?? 'coding',
    requireTools: true,
  });
  const maxSteps = Math.min(Math.max(input.maxSteps ?? 12, 1), 30);

  const run = await store.createRun({
    projectId: input.projectId,
    conversationId: input.conversationId ?? null,
    modelId: resolution.model.id,
    providerId: resolution.model.provider,
    prompt: input.prompt,
  });

  const recordEvent = async (type: string, payload: unknown) => {
    try {
      await store.appendRunEvent(run.id, type, payload);
    } catch (err) {
      log.warn('failed to persist agent event', { error: String(err) });
    }
  };

  for (const w of resolution.warnings) emit({ type: 'agent.status', runId: run.id, status: 'running', step: 0, note: w });
  emit({ type: 'agent.start', runId: run.id, modelId: resolution.model.id, provider: resolution.model.provider, maxSteps });
  await recordEvent('start', { modelId: resolution.model.id, provider: resolution.model.provider, warnings: resolution.warnings });

  const project = await store.getProject(input.projectId);
  if (!project) {
    await store.updateRun(run.id, { status: 'failed', error: `project ${input.projectId} not found`, finishedAt: new Date().toISOString() });
    emit({ type: 'error', message: `Project ${input.projectId} not found.`, code: 'project_not_found' });
    return { runId: run.id, status: 'failed', summary: 'project not found', steps: 0, toolCalls: 0, proposedChanges: [], modelId: resolution.model.id };
  }

  const [files, tasks, projectMemory, globalMemory] = await Promise.all([
    store.listFiles(input.projectId),
    store.listTasks({ projectId: input.projectId }),
    store.listMemory('project', input.projectId),
    store.listMemory('global', null),
  ]);

  const systemPrompt = buildAgentSystemPrompt({
    project,
    files,
    tasks,
    memory: [...projectMemory, ...globalMemory],
    sandbox: deps.sandbox.status(),
    terminalEnabled: Boolean(input.allowTerminal),
    autoApply: Boolean(input.autoApply),
    extraInstructions: input.systemPromptExtra,
  });

  const messages: ChatTurn[] = [{ role: 'system', content: systemPrompt }];
  if (input.conversationId) {
    const history = await store.listMessages(input.conversationId, HISTORY_TURNS);
    for (const m of history) {
      if (m.role === 'system') continue;
      messages.push({ role: m.role, content: truncate(m.content, 4000), toolCalls: m.toolCalls, toolCallId: m.toolCallId, toolName: m.toolName });
    }
  }
  messages.push({ role: 'user', content: input.prompt });

  const toolCtx: ToolContext = {
    store,
    git,
    sandbox: deps.sandbox,
    cfg,
    projectId: input.projectId,
    runId: run.id,
    autoApply: Boolean(input.autoApply),
    allowTerminal: Boolean(input.allowTerminal),
    log,
    emit,
    recordEvent,
  };

  let steps = 0;
  let toolCallCount = 0;
  let finalSummary = '';
  let failed = false;
  let failureMessage = '';
  const signatures = new Map<string, number>();

  try {
    while (steps < maxSteps) {
      if (signal?.aborted) throw new HttpError(499, 'Run cancelled by user.', 'cancelled');
      steps++;
      emit({ type: 'agent.status', runId: run.id, status: 'running', step: steps });
      await store.updateRun(run.id, { steps });

      let assistantText = '';
      let reasoningText = '';
      let pendingThought = '';
      const flushThought = () => {
        if (!pendingThought) return;
        emit({ type: 'agent.thought', runId: run.id, text: pendingThought });
        pendingThought = '';
      };

      let result;
      try {
        result = await router.complete(
          {
            modelId: resolution.model.id,
            messages,
            tools: toolSpecs(input.toolNames),
            toolChoice: 'auto',
            stream: true,
            temperature: 0.2,
            signal,
          },
          {
            onText: (chunk) => {
              assistantText += chunk;
              pendingThought += chunk;
              if (pendingThought.length >= 120 || chunk.includes('\n')) flushThought();
            },
            onReasoning: (chunk) => {
              reasoningText += chunk;
            },
          },
          'agent',
        );
      } catch (err) {
        const { message, code } = describeError(err);
        emit({ type: 'error', message, code, retryable: code === 'rate_limited' });
        throw err;
      }
      flushThought();
      if (reasoningText) await recordEvent('reasoning', { text: truncate(reasoningText, 2000) });

      const toolCalls = result.toolCalls ?? [];
      messages.push({ role: 'assistant', content: assistantText || (toolCalls.length ? '' : '(no content)'), toolCalls: toolCalls.length ? toolCalls : undefined });

      if (toolCalls.length === 0) {
        finalSummary = assistantText.trim();
        break;
      }

      for (const call of toolCalls) {
        toolCallCount++;
        const sig = `${call.name}:${stableStringify(call.arguments)}`;
        const repeats = (signatures.get(sig) ?? 0) + 1;
        signatures.set(sig, repeats);

        emit({ type: 'agent.tool.start', runId: run.id, callId: call.id, name: call.name, args: call.arguments ?? {} });
        await recordEvent('tool.start', { callId: call.id, name: call.name, args: call.arguments });

        let outcome: ToolResult;
        if (repeats >= 4) {
          outcome = {
            ok: false,
            output: `ERROR: loop guard — you have called ${call.name} with identical arguments ${repeats} times. Stop repeating. Either change your approach, report the blocker to the user, or finish with a summary.`,
          };
        } else {
          outcome = await executeTool(call, toolCtx, log);
        }

        emit({
          type: 'agent.tool.result',
          runId: run.id,
          callId: call.id,
          name: call.name,
          ok: outcome.ok,
          output: truncate(outcome.output, 4000),
          truncated: Boolean(outcome.meta?.truncated),
          meta: outcome.meta,
        });
        await recordEvent('tool.result', { callId: call.id, name: call.name, ok: outcome.ok, output: truncate(outcome.output, 1500) });

        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: truncate(outcome.output, MAX_TOOL_RESULT_CHARS),
        });

        if (repeats >= 5) {
          failed = true;
          failureMessage = `Aborted: the agent repeated "${call.name}" with the same arguments 5 times.`;
          break;
        }
      }
      if (failed) break;

      if (steps === maxSteps) {
        finalSummary = `Step limit reached (${maxSteps}). Partial progress was saved; ask me to continue and I will pick up from the task list.`;
      }
    }
  } catch (err) {
    failed = true;
    const { message } = describeError(err);
    failureMessage = failureMessage || message;
    log.error('agent run failed', { runId: run.id, error: message });
  }

  const pending = await store.listChanges(input.projectId, 'pending');
  const status: AgentRunOutcome['status'] = failed ? 'failed' : pending.length > 0 ? 'awaiting_approval' : 'completed';
  const summary = failed
    ? failureMessage
    : finalSummary ||
      (pending.length
        ? `Created ${pending.length} change proposal(s) awaiting your approval.`
        : 'Completed with no file changes.');

  const finishedAt = new Date().toISOString();
  await store.updateRun(run.id, { status, steps, summary: truncate(summary, 4000), error: failed ? failureMessage : undefined, finishedAt });
  await recordEvent('done', { status, steps, toolCallCount, pending: pending.map((p) => p.id) });

  // Mirror the run into the conversation so the chat history stays complete.
  if (input.conversationId) {
    await store.appendMessage({
      id: newId('msg'),
      conversationId: input.conversationId,
      role: 'user',
      content: input.prompt,
      status: 'complete',
      modelId: resolution.model.id,
      providerId: resolution.model.provider,
    });
    await store.appendMessage({
      id: newId('msg'),
      conversationId: input.conversationId,
      role: 'assistant',
      content: summary,
      status: failed ? 'error' : 'complete',
      modelId: resolution.model.id,
      providerId: resolution.model.provider,
      error: failed ? failureMessage : undefined,
    });
  }

  if (status === 'awaiting_approval') {
    emit({
      type: 'agent.await.approval',
      runId: run.id,
      changeIds: pending.map((p) => p.id),
      reason: `${pending.length} change proposal(s) are waiting for your review in the Diff panel.`,
    });
  }

  const finalRun = (await store.getRun(run.id))!;
  emit({ type: 'agent.done', runId: run.id, run: finalRun, summary });
  return { runId: run.id, status, summary, steps, toolCalls: toolCallCount, proposedChanges: pending.map((p) => p.id), modelId: resolution.model.id };
}

async function executeTool(call: ToolCallRequest, ctx: ToolContext, log: Logger): Promise<ToolResult> {
  const tool = TOOL_MAP.get(call.name);
  if (!tool) {
    return {
      ok: false,
      output: `ERROR: unknown tool "${call.name}". Available tools: ${[...TOOL_MAP.keys()].join(', ')}.`,
    };
  }
  try {
    return await tool.run(call.arguments ?? {}, ctx);
  } catch (err) {
    const { message } = describeError(err);
    log.warn('tool crashed', { tool: call.name, error: message });
    return { ok: false, output: `ERROR: tool "${call.name}" failed: ${message}` };
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value);
  const obj = value as Record<string, unknown>;
  return JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}
