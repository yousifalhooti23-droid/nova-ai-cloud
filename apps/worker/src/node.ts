/**
 * Node dev runtime.
 *
 * Same Hono app, same routes, same agent — but storage is JSON-file backed and
 * the Workers AI binding obviously does not exist. Useful when you cannot run
 * wrangler (CI, restricted machines) and for local UI work.
 *
 * Run with: npm run dev:node   (then `npm run dev:web` for the UI)
 */
import { bootstrap } from './bootstrap.js';
import type { RawEnv } from './env.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

function envFromProcess(): RawEnv {
  const env: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.NOVA_RUNTIME = 'node';
  if (!env.NOVA_ENV_FILE) env.NOVA_ENV_FILE = '.env';
  return env as RawEnv;
}

// Load .env / .dev.vars without a dependency (tiny parser, KEY=VALUE lines).
async function loadDotEnv() {
  const fs = await import('node:fs');
  for (const file of ['.env', '.dev.vars', 'apps/worker/.dev.vars']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
    console.log(`[nova] loaded ${file}`);
  }
}

await loadDotEnv();
const { app, deps } = await bootstrap({ env: envFromProcess(), logLevel: (process.env.NOVA_LOG_LEVEL as never) ?? 'info' });

const server = {
  async listen() {
    const { serve } = await import('@hono/node-server');
    serve({ fetch: app.fetch as never, port: PORT, hostname: HOST }, (info) => {
      console.log(`[nova] node runtime listening on http://${info.address}:${info.port}`);
      console.log(`[nova] store=${deps.store.kind} sandbox=${deps.sandbox.status().kind}`);
      console.log(`[nova] providers: ${deps.router.providerInfos().map((p) => `${p.id}=${p.status}`).join(' ')}`);
    });
  },
};

await server.listen();
