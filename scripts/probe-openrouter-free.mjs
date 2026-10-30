#!/usr/bin/env node
/**
 * NOVA — OpenRouter free-model availability probe
 * ===============================================
 * OpenRouter's public /api/v1/models does NOT expose the "agentic harness"
 * gate, so a `:free` model can look available and still answer 403. The only
 * reliable way to know is to ask it.
 *
 * This script probes every `:free` model with a 1-token request and prints
 * which ones actually answer with a plain API key.
 *
 *   node scripts/probe-openrouter-free.mjs [--all]
 *
 * Reads OPENROUTER_API_KEY from apps/worker/.dev.vars (never printed).
 * Paced to stay under OpenRouter's 20 requests/minute free-tier limit.
 * Costs ~1 daily request per model probed (50/day below $10 lifetime credits).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://openrouter.ai/api/v1';
const GAP_MS = 3300; // ~18 req/min, under the 20/min free limit

// ---------------------------------------------------------------- load the key
function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const f = path.join(root, 'apps/worker/.dev.vars');
  try {
    const line = readFileSync(f, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('OPENROUTER_API_KEY='));
    const v = line?.slice('OPENROUTER_API_KEY='.length).trim();
    if (v) return v;
  } catch {}
  console.error('No OPENROUTER_API_KEY found in apps/worker/.dev.vars');
  process.exit(1);
}
const KEY = loadKey();
const masked = `${KEY.slice(0, 11)}…${KEY.slice(-4)}`;

// ------------------------------------------------------------ fetch free list
const listRes = await fetch(`${BASE_URL}/models`);
const list = await listRes.json();
let free = (list.data ?? []).filter(
  (m) => m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0',
);
if (!process.argv.includes('--all')) {
  // text-capable only: skip audio-only and safety classifiers
  free = free.filter((m) => (m.architecture?.input_modalities ?? []).includes('text') &&
                             (m.architecture?.output_modalities ?? []).includes('text'));
}
console.log(`\nProbing ${free.length} OpenRouter ":free" models with key ${masked}`);
console.log(`Pace: one request every ${GAP_MS}ms (free limit is 20/min)\n`);

// ------------------------------------------------------------------- probe one
async function probe(model) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'Say: ok' }],
        max_tokens: 4,
        stream: false,
      }),
    });
    const ms = Date.now() - t0;
    const raw = await r.text();
    if (r.ok) {
      let out = '';
      try { out = (JSON.parse(raw).choices?.[0]?.message?.content ?? '').trim(); } catch {}
      return { id: model.id, status: r.status, verdict: 'WORKS', detail: out.slice(0, 40) || '(empty)', ms };
    }
    let msg = '';
    try { msg = JSON.parse(raw)?.error?.message ?? raw; } catch { msg = raw; }
    const m = String(msg);
    let verdict = `HTTP ${r.status}`;
    if (/agentic harness/i.test(m)) verdict = 'GATED (agentic harness only)';
    else if (/rate limit|429/i.test(m) || r.status === 429) verdict = 'RATE LIMITED';
    else if (r.status === 401 || r.status === 403) verdict = 'REFUSED';
    else if (r.status === 503 || /no.*provider|overloaded/i.test(m)) verdict = 'NO PROVIDER';
    return { id: model.id, status: r.status, verdict, detail: m.replace(/\s+/g, ' ').slice(0, 110), ms };
  } catch (e) {
    return { id: model.id, status: 0, verdict: 'NETWORK', detail: e.message, ms: Date.now() - t0 };
  }
}

// ------------------------------------------------------------------ run paced
const results = [];
for (let i = 0; i < free.length; i++) {
  const m = free[i];
  const res = await probe(m);
  results.push({ ...res, ctx: m.context_length, tools: (m.supported_parameters ?? []).includes('tools') });
  const icon = res.verdict === 'WORKS' ? '\x1b[32m✓\x1b[0m' : res.verdict.startsWith('GATED') ? '\x1b[33m⊘\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${String(i + 1).padStart(2)}/${free.length} ${icon} ${res.verdict.padEnd(28)} ${m.id}  \x1b[2m${res.ms}ms\x1b[0m`);
  if (res.verdict !== 'WORKS' && res.detail) console.log(`        \x1b[2m${res.detail}\x1b[0m`);
  if (i < free.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
}

// --------------------------------------------------------------------- report
const works = results.filter((r) => r.verdict === 'WORKS');
const gated = results.filter((r) => r.verdict.startsWith('GATED'));
const other = results.filter((r) => r.verdict !== 'WORKS' && !r.verdict.startsWith('GATED'));

console.log(`\n${'='.repeat(78)}`);
console.log(`\x1b[1mWORKS with a plain key (${works.length})\x1b[0m`);
for (const r of works) console.log(`  ✓ ${r.id.padEnd(56)} ctx=${r.ctx} tools=${r.tools ? 'yes' : 'no'}`);
console.log(`\n\x1b[1mGATED — agentic harness only (${gated.length})\x1b[0m`);
for (const r of gated) console.log(`  ⊘ ${r.id}`);
if (other.length) {
  console.log(`\n\x1b[1mOTHER (${other.length})\x1b[0m`);
  for (const r of other) console.log(`  ✗ ${r.id} → ${r.verdict}: ${r.detail}`);
}
console.log(`\n${'='.repeat(78)}\n`);

// machine-readable, so the catalog can be updated from it
const out = path.join(root, 'scripts', '.openrouter-probe.json');
const { writeFileSync } = await import('node:fs');
writeFileSync(out, JSON.stringify({ probedAt: new Date().toISOString(), results }, null, 2));
console.log(`Raw results → ${out}\n`);
