/** Deterministic fixtures mirroring real worker responses (shapes from @nova/shared). */
const now = '2026-10-30T09:00:00.000Z';

export const diagnosticProvider = {
  id: 'diagnostic',
  label: 'Diagnostic echo',
  status: 'ready',
  detail: 'Echo adapter enabled (NOVA_ENABLE_DIAGNOSTIC=true). Not a real model.',
  modelCount: 1,
  simulated: true,
};

export const workersAiProvider = {
  id: 'workers-ai',
  label: 'Cloudflare Workers AI',
  status: 'needs-remote',
  detail: 'Local `wrangler dev` cannot reach the AI binding.',
  modelCount: 12,
  simulated: false,
  docsUrl: 'https://developers.cloudflare.com/workers-ai/',
};

export const openrouterProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  status: 'missing-key',
  detail: 'OPENROUTER_API_KEY is not set.',
  modelCount: 19,
  simulated: false,
};

export const health = (overrides: Partial<Record<'providers', unknown[]>> = {}) => ({
  ok: true,
  version: '0.1.0',
  runtime: 'workers',
  store: { kind: 'd1', ready: true, detail: 'D1 nova-db (local)' },
  blob: { kind: 'r2', ready: true },
  sandbox: { kind: 'disabled', ready: false, detail: 'Sandbox is not configured — command execution is disabled.' },
  providers: overrides.providers ?? [workersAiProvider, openrouterProvider, diagnosticProvider],
  time: now,
});

export const models = {
  models: [
    {
      id: 'diagnostic:echo',
      provider: 'diagnostic',
      upstreamId: 'echo',
      label: 'echo (diagnostic)',
      vendor: 'nova',
      classes: ['chat', 'coding'],
      contextWindow: 8192,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsSystemRole: true,
      pricing: null,
      freeTier: 'free',
      access: 'open',
      verifiedAt: '2026-10-30',
      notes: 'NOT an AI model — deterministic echo used for plumbing tests.',
    },
    {
      id: 'workers-ai:@cf/qwen/qwen3.8-27b',
      provider: 'workers-ai',
      upstreamId: '@cf/qwen/qwen3.8-27b',
      label: 'Qwen3.8 27B',
      vendor: 'qwen',
      classes: ['chat', 'coding', 'long-context'],
      contextWindow: 262144,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsSystemRole: true,
      pricing: null,
      freeTier: 'free',
      access: 'open',
      verifiedAt: '2026-10-30',
    },
    {
      id: 'workers-ai:@cf/swiss-ai/apertus-v1.5-8b',
      provider: 'workers-ai',
      upstreamId: '@cf/swiss-ai/apertus-v1.5-8b',
      label: 'Apertus 8B',
      vendor: 'swiss-ai',
      classes: ['chat'],
      contextWindow: 32768,
      supportsTools: false,
      supportsStreaming: true,
      supportsVision: false,
      supportsSystemRole: true,
      pricing: null,
      freeTier: 'free',
      access: 'gated',
      verifiedAt: '2026-10-30',
    },
  ],
  providers: [workersAiProvider, openrouterProvider, diagnosticProvider],
  defaults: { chat: 'workers-ai:@cf/qwen/qwen3.8-27b', reasoning: null, coding: null, 'long-context': null },
  catalogVerifiedAt: '2026-10-30',
  notes: ['Free-tier eligibility verified 2026-10-30.'],
};

export const sandboxStatus = {
  kind: 'disabled',
  ready: false,
  detail: 'Sandbox is not configured — command execution is disabled.',
  capabilities: [],
  isolationNotes: ['No bindings are exposed to the sandbox.', 'Fail-closed by design.'],
};

export const settings = {
  locale: 'ar',
  dir: 'rtl',
  defaults: { chat: null, reasoning: null, coding: null, 'long-context': null },
  agent: { maxSteps: 12, autoApply: false, allowTerminal: false },
};

export const conversation = {
  id: 'conv_1',
  title: 'محادثة التجربة',
  projectId: null,
  modelId: null,
  modelClass: 'chat',
  memoryEnabled: false,
  archived: false,
  createdAt: now,
  updatedAt: now,
  messageCount: 0,
};

export const project = {
  id: 'prj_1',
  name: 'demo-app',
  description: 'مشروع تجريبي',
  language: 'typescript',
  defaultBranch: 'main',
  createdAt: now,
  updatedAt: now,
  stats: { files: 2, commits: 1, pendingChanges: 1, openTasks: 1 },
};

export const fileSummaries = {
  files: [
    { path: 'src/app.ts', sizeBytes: 24, sha: 'sha_a', language: 'typescript', updatedAt: now },
    { path: 'README.md', sizeBytes: 12, sha: 'sha_b', language: 'markdown', updatedAt: now },
  ],
};

export const fileContent = (path: string) => ({
  file: {
    id: 'file_1',
    projectId: 'prj_1',
    path,
    content: path.endsWith('.ts') ? 'export const answer = 42;\n' : '# demo\n',
    sha: path.endsWith('.ts') ? 'sha_a' : 'sha_b',
    sizeBytes: 24,
    language: path.endsWith('.ts') ? 'typescript' : 'markdown',
    status: 'active',
    updatedAt: now,
  },
  language: path.endsWith('.ts') ? 'typescript' : 'markdown',
});

export const change = {
  id: 'chg_1',
  projectId: 'prj_1',
  runId: 'run_1',
  path: 'src/app.ts',
  kind: 'update',
  before: 'export const answer = 42;\n',
  after: 'export const answer = 43; // updated by agent\n',
  status: 'pending',
  reason: 'رفع القيمة حسب الطلب',
  createdAt: now,
  appliedAt: null,
  additions: 1,
  deletions: 1,
};

export const gitStatus = {
  branch: 'main',
  head: { id: 'cmt_abc1234567', message: 'chore: init', createdAt: now, author: 'user' },
  workingTree: { added: [], modified: ['src/app.ts'], deleted: [], clean: false },
  pendingProposals: [{ id: 'chg_1', path: 'src/app.ts', kind: 'update', reason: change.reason }],
  fileCount: 2,
};

export const commits = {
  commits: [
    {
      id: 'cmt_abc1234567',
      projectId: 'prj_1',
      parentId: null,
      message: 'chore: init',
      author: 'user',
      branch: 'main',
      tree: { 'src/app.ts': 'sha_a' },
      stats: { files: 1, additions: 1, deletions: 0 },
      createdAt: now,
    },
  ],
};

export const tasks = {
  tasks: [
    { id: 'task_1', projectId: 'prj_1', runId: 'run_1', title: 'قراءة الملفات', detail: '', status: 'done', order: 0, createdAt: now, updatedAt: now },
    { id: 'task_2', projectId: 'prj_1', runId: 'run_1', title: 'تعديل القيمة', detail: '', status: 'in_progress', order: 1, createdAt: now, updatedAt: now },
  ],
};
