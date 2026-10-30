/**
 * NOVA standalone desktop server (the Tauri sidecar).
 * ===================================================
 * Bundled by `scripts/build-sidecar.mjs` into ONE executable that the Tauri
 * shell spawns. It serves:
 *
 *   - the full HTTP API (same Hono app as the Workers/Node runtimes)
 *   - the built web UI, embedded in the binary (no browser, no web server)
 *
 * so the desktop app is self-contained. AI models are NOT embedded — they are
 * called over the network (OpenRouter / Cloudflare), exactly like the web app.
 *
 * Storage is the JSON file store under `<exe dir>/nova-data`. Config is read
 * from `.env` (or `nova.env`) next to the executable.
 */
import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrap } from './bootstrap.js';
import type { RawEnv } from './env.js';
import { WEB_ASSETS } from './web-assets.generated.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Directory of the running executable (pkg) or cwd (plain node). */
function baseDir(): string {
  const packed = (process as unknown as { pkg?: unknown }).pkg !== undefined;
  return packed ? path.dirname(process.execPath) : process.cwd();
}

/** Tiny KEY=VALUE loader; never overrides a real environment variable. */
function loadEnvFile(dir: string) {
  for (const name of ['.env', 'nova.env']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let value = t.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
    console.log(`[nova-sidecar] loaded config from ${file}`);
  }
}

const base = baseDir();
loadEnvFile(base);
loadEnvFile(process.cwd());

const PORT = Number(process.env.PORT ?? 8787);
// Loopback only: a desktop app must not expose its API to the LAN by default.
const HOST = process.env.HOST ?? '127.0.0.1';
if (process.env.NOVA_DATA_DIR === undefined) process.env.NOVA_DATA_DIR = path.join(base, 'nova-data');

function envFromProcess(): RawEnv {
  const env: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.NOVA_RUNTIME = 'node';
  return env as RawEnv;
}

function assetResponse(body: string, mime: string, method: string): Response {
  const buf = Buffer.from(body, 'base64');
  return new Response(method === 'HEAD' ? null : buf, {
    status: 200,
    headers: {
      'content-type': mime,
      'content-length': String(buf.byteLength),
      // hashed assets are immutable; index.html must always revalidate
      'cache-control': mime.startsWith('text/html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    },
  });
}

function makeHandler(app: { fetch: (req: Request) => Promise<Response> | Response }) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === 'GET' || req.method === 'HEAD') {
      let p = decodeURIComponent(url.pathname);
      if (p === '/' || p === '') p = '/index.html';
      const hit = WEB_ASSETS[p];
      if (hit) return assetResponse(hit.d, MIME[path.extname(p)] ?? 'application/octet-stream', req.method);
      // SPA fallback: any non-API path renders the app shell.
      if (!p.startsWith('/api/')) {
        const index = WEB_ASSETS['/index.html'];
        if (index) return assetResponse(index.d, MIME['.html'], req.method);
      }
    }
    return app.fetch(req);
  };
}

async function main() {
  const { app, deps } = await bootstrap({ env: envFromProcess(), logLevel: 'info' });
  const handler = makeHandler(app as never);
  serve({ fetch: handler as never, port: PORT, hostname: HOST }, (info) => {
    console.log(`[nova-sidecar] ready on http://${info.address}:${info.port}`);
    console.log(`[nova-sidecar] store=${deps.store.kind} sandbox=${deps.sandbox.status().kind}`);
    console.log(`[nova-sidecar] providers: ${deps.router.providerInfos().map((p) => `${p.id}=${p.status}`).join(' ')}`);
    console.log(`[nova-sidecar] data dir: ${process.env.NOVA_DATA_DIR}`);
  });
}

main().catch((err) => {
  console.error('[nova-sidecar] fatal:', err);
  process.exit(1);
});
