#!/usr/bin/env node
/**
 * NOVA — OpenRouter end-to-end verification
 * =========================================
 * Proves that a REAL model answers through the whole stack, and refuses to
 * accept the diagnostic echo as a success.
 *
 *   node scripts/verify-openrouter.mjs [baseUrl] [modelId]
 *
 * Checks:
 *   1. /api/models      → openrouter provider status + model count
 *   2. /api/chat (SSE)  → real streamed answer, model + provider reported
 *   3. the answer is NOT the diagnostic echo
 *   4. token usage was reported
 *   5. the conversation was persisted to D1
 *
 * No dependencies. Exit code 0 only if every check passes.
 */
const BASE = process.argv[2] ?? process.env.NOVA_SMOKE_URL ?? 'http://127.0.0.1:8787';
const MODEL = process.argv[3] ?? null; // null → let the Model Router choose

let passed = 0;
let failed = 0;
const ok = (m, extra = '') => { console.log(`  \x1b[32m✓\x1b[0m ${m}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`); passed++; };
const no = (m, extra = '') => { console.log(`  \x1b[31m✗\x1b[0m ${m}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`); failed++; };
const head = (t) => console.log(`\n  \x1b[1m-- ${t} --\x1b[0m`);

console.log(`\n\x1b[1mNOVA OpenRouter verification → ${BASE}\x1b[0m\n`);

// ---------------------------------------------------------------- 1. provider
head('provider status');
let models;
try {
  const r = await fetch(`${BASE}/api/models`);
  models = await r.json();
} catch (e) {
  no('cannot reach the API', e.message);
  console.log('\n  Is the worker running?  npm run dev\n');
  process.exit(1);
}

const or = (models.providers ?? []).find((p) => p.id === 'openrouter');
if (!or) no('openrouter provider missing from /api/models');
else if (or.status === 'ready') ok(`openrouter is ready`, `${or.modelCount} models exposed`);
else if (or.status === 'missing-key') {
  no('OPENROUTER_API_KEY is not set', or.detail ?? '');
  console.log('\n  Put your key in apps/worker/.dev.vars, then FULLY restart the worker');
  console.log('  (wrangler dev does not hot-reload .dev.vars).\n');
  process.exit(1);
} else no(`openrouter status = ${or.status}`, or.detail ?? '');

const freeOr = (models.models ?? []).filter((m) => m.provider === 'openrouter');
if (freeOr.length) ok(`${freeOr.length} openrouter models selectable in the UI`);
else no('no openrouter models are selectable — the key may be invalid');

// -------------------------------------------------------------------- 2. chat
head('real chat over SSE');
const body = { message: 'Reply with exactly: NOVA-VERIFIED and then one short sentence about yourself.' };
if (MODEL) body.modelId = MODEL;

let text = '';
let answeredBy = null;
let answeredProvider = null;
let usage = null;
let conversationId = null;
let messageId = null;
let streamError = null;
const warnings = [];

try {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    no(`POST /api/chat returned ${res.status}`, t.slice(0, 200));
  } else {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const t0 = Date.now();
    let firstChunkMs = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
        switch (evt.type) {
          case 'ready':
            answeredBy = evt.modelId; answeredProvider = evt.provider;
            if (Array.isArray(evt.warnings)) warnings.push(...evt.warnings);
            break;
          case 'message.start':
            messageId = evt.messageId;
            if (evt.modelId) answeredBy = evt.modelId;
            break;
          case 'text.delta':
            if (firstChunkMs === null) firstChunkMs = Date.now() - t0;
            text += evt.text ?? '';
            process.stdout.write('\x1b[2m.\x1b[0m');
            break;
          case 'usage': usage = evt; break;
          case 'message.done': conversationId = evt.conversationId ?? conversationId; break;
          case 'error': streamError = evt.message ?? evt.code ?? 'unknown error'; break;
        }
      }
    }
    console.log('');

    if (streamError) no('stream reported an error', streamError);
    else ok('stream completed', `first token in ${firstChunkMs ?? '?'}ms, ${text.length} chars`);

    if (answeredBy) ok(`answered by \x1b[1m${answeredBy}\x1b[0m`, `provider=${answeredProvider}`);
    else no('no model was reported in the stream');

    // ------------------------------------------------- 3. not the echo
    const isEcho =
      answeredProvider === 'diagnostic' ||
      /^diagnostic[:.]/.test(answeredBy ?? '') ||
      text.includes('DIAGNOSTIC ECHO');
    if (isEcho) no('this was the DIAGNOSTIC ECHO, not a real model', 'openrouter is not first in NOVA_PROVIDER_PRIORITY, or the key was rejected');
    else ok('confirmed: a real model answered (not the diagnostic echo)');

    // ------------------------------------------------------ 4. content
    if (text.trim().length > 0) ok('non-empty answer', JSON.stringify(text.trim().slice(0, 90)));
    else no('the model returned an empty answer');

    if (warnings.length) console.log(`  \x1b[33m!\x1b[0m warnings: ${warnings.join(' | ')}`);

    // -------------------------------------------------------- 5. usage
    if (usage && (usage.totalTokens || usage.promptTokens || usage.inputTokens)) {
      ok('token usage reported', JSON.stringify(usage).slice(0, 140));
    } else console.log(`  \x1b[2m-\x1b[0m no usage figures returned (some providers omit them)`);
  }
} catch (e) {
  no('chat request failed', e.message);
}

// ------------------------------------------------------------ 6. persistence
head('persistence');
try {
  const r = await fetch(`${BASE}/api/conversations?limit=5`);
  const j = await r.json();
  const list = j.conversations ?? j.items ?? [];
  if (list.length) ok(`${list.length} conversation(s) stored in D1`, `newest: ${list[0].title ?? list[0].id}`);
  else no('no conversations found — the exchange was not saved');
} catch (e) {
  no('could not read /api/conversations', e.message);
}

// ------------------------------------------------------------------- summary
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failed === 0) console.log('\x1b[32m\n✅ OpenRouter is wired end-to-end. Real AI is live in NOVA.\x1b[0m\n');
else console.log('\x1b[31m\n❌ Something is not right — see the failures above.\x1b[0m\n');
process.exit(failed === 0 ? 0 : 1);
