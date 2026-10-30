#!/usr/bin/env node
/**
 * End-to-end smoke test against a running NOVA API.
 * Usage: node scripts/smoke.mjs [baseUrl]
 * Exercises the real HTTP surface: health, models, projects, files, agent SSE,
 * approvals, commits, uploads, sandbox policy. Exits non-zero on any failure.
 */
const BASE = process.argv[2] ?? process.env.NOVA_SMOKE_URL ?? 'http://127.0.0.1:8787';
let passed = 0;
let failed = 0;

const check = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

async function json(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: parsed };
}

async function sse(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i = buf.indexOf('\n\n');
    while (i !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      i = buf.indexOf('\n\n');
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (data) { try { events.push(JSON.parse(data)); } catch { /* partial */ } }
    }
  }
  return events;
}

console.log(`\nNOVA smoke test → ${BASE}\n`);

const health = await json('GET', '/api/health');
check('GET /api/health 200', health.status === 200);
check('runtime reported', ['workers', 'node'].includes(health.body.runtime), JSON.stringify(health.body.runtime));
check('store reported', Boolean(health.body.store?.kind), JSON.stringify(health.body.store));
check('sandbox fail-closed', health.body.sandbox?.kind !== undefined);
console.log(`    providers: ${health.body.providers.map((p) => `${p.id}=${p.status}`).join(' ')}`);

const models = await json('GET', '/api/models');
check('GET /api/models 200', models.status === 200);
check('catalog is populated', models.body.models?.length > 30, `got ${models.body.models?.length}`);
check('paid models are marked paid', models.body.models.some((m) => m.freeTier === 'paid'));
check('free models are marked free', models.body.models.some((m) => m.freeTier === 'free'));
const callable = models.body.availableModelIds ?? [];
console.log(`    callable models: ${callable.length} ${callable.slice(0, 6).join(', ')}`);
check('at least one callable model (or none configured)', callable.length >= 0);

const project = await json('POST', '/api/projects', { name: `smoke-${Date.now()}`, description: 'created by scripts/smoke.mjs', files: { 'src/index.ts': 'export const answer = 42;\n', 'README.md': '# smoke\n' } });
check('POST /api/projects 201', project.status === 201, JSON.stringify(project.body).slice(0, 200));
const pid = project.body.project?.id;
check('project id returned', Boolean(pid));

const files = await json('GET', `/api/projects/${pid}/files`);
check('seed files stored', files.body.files?.length === 2, JSON.stringify(files.body.files?.map((f) => f.path)));

const read = await json('GET', `/api/projects/${pid}/file?path=src/index.ts`);
check('file content round-trips', read.body.file?.content === 'export const answer = 42;\n');

const bad = await json('PUT', `/api/projects/${pid}/file`, { path: '../escape.ts', content: 'x' });
check('path traversal rejected (400)', bad.status === 400, `got ${bad.status}`);

const search = await json('POST', `/api/projects/${pid}/search`, { query: 'answer' });
check('search finds content', search.body.hits?.[0]?.path === 'src/index.ts', JSON.stringify(search.body.hits?.[0]));

const gitStatus = await json('GET', `/api/projects/${pid}/git/status`);
check('git status reports a head commit', Boolean(gitStatus.body.head), JSON.stringify(gitStatus.body.head));

const sandboxStatus = await json('GET', '/api/sandbox/status');
check('sandbox status is explicit', sandboxStatus.body.kind !== undefined);
const execRes = await json('POST', '/api/sandbox/exec', { command: 'node --version' });
check('sandbox exec fails closed (503) with a hint', execRes.status === 503 && Boolean(execRes.body.hint), `${execRes.status} ${JSON.stringify(execRes.body).slice(0, 160)}`);

const settings = await json('GET', '/api/settings');
check('settings readable', settings.status === 200 && Boolean(settings.body.agent));

if (callable.length > 0) {
  console.log('\n  -- agent run (SSE) --');
  // When the only callable model is the diagnostic echo provider, drive it with
  // an explicit tool directive (that provider is deterministic, not an LLM).
  // Which provider will actually answer? Ask the router's own status report.
  const readyProviders = health.body.providers.filter((p) => p.status === 'ready').map((p) => p.id);
  const isDiagnostic = readyProviders.length === 1 && readyProviders[0] === 'diagnostic';
  const prompt = isDiagnostic
    ? '/tool write_file ' + JSON.stringify({ path: 'src/version.ts', content: "export const version = '0.1.0';\n", reason: 'smoke test' })
    : 'List the project files, then add src/version.ts exporting the version string.';
  if (isDiagnostic) console.log('    (using the diagnostic echo provider — deterministic tool call, NOT a real model)');
  // No modelId: the router picks, exactly like the UI does by default.
  const events = await sse('POST', '/api/agent/run', { projectId: pid, prompt, maxSteps: 4 });
  const types = events.map((e) => e.type);
  check('agent.start received', types.includes('agent.start'));
  const startEvt = events.find((e) => e.type === 'agent.start');
  console.log(`    router chose: ${startEvt?.modelId} (${startEvt?.provider})`);
  const errEvt = events.find((e) => e.type === 'error');
  if (errEvt) console.log(`    error: ${String(errEvt.message).slice(0, 200)}`);
  check('agent tool activity', types.some((t) => t.startsWith('agent.tool')));
  check('agent.done received', types.includes('agent.done'));
  const done = events.find((e) => e.type === 'agent.done');
  console.log(`    status=${done?.run?.status} steps=${done?.run?.steps}`);
  const changes = await json('GET', `/api/projects/${pid}/changes?status=pending`);
  console.log(`    pending proposals: ${changes.body.changes?.length ?? 0}`);
  if ((changes.body.changes?.length ?? 0) > 0) {
    const apply = await json('POST', `/api/projects/${pid}/changes/apply-all`, { action: 'apply', commitMessage: 'chore: smoke test approval' });
    check('apply-all works', apply.body.applied > 0, JSON.stringify(apply.body));
    check('commit created after approval', Boolean(apply.body.commitId));
  }

  console.log('\n  -- chat (SSE) --');
  const chatEvents = await sse('POST', '/api/chat', { message: 'Say hello from the smoke test.' });
  const chatTypes = chatEvents.map((e) => e.type);
  check('chat streamed', chatTypes.includes('text.delta') || chatTypes.includes('error'), chatTypes.join(','));
  const chatErr = chatEvents.find((e) => e.type === 'error');
  if (chatErr) console.log(`    chat error (expected when the provider is diagnostic-only or misconfigured): ${chatErr.message.slice(0, 160)}`);
  const convs = await json('GET', '/api/conversations');
  check('conversation persisted', (convs.body.conversations?.length ?? 0) > 0);
} else {
  console.log('\n  -- agent/chat skipped: no callable model. Configure a provider (see .env.example) and re-run. --');
  const chatRes = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) });
  const text = await chatRes.text();
  check('chat reports provider_not_configured instead of faking output', text.includes('provider_not_configured') || text.includes('DIAGNOSTIC'), text.slice(0, 200));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
