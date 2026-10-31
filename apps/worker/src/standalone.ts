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
 * User data and saved keys live under `%APPDATA%\NOVA AI Cloud` in installed
 * mode (so app updates and uninstalls never collide with `sidecar\`), or next
 * to the executable when `portable.marker` is present (Portable mode).
 */
import { serve } from '@hono/node-server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
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

const isPacked = (process as unknown as { pkg?: unknown }).pkg !== undefined;
const exeDir = isPacked ? path.dirname(process.execPath) : process.cwd();
const installRoot = path.basename(exeDir).toLowerCase() === 'sidecar' ? path.dirname(exeDir) : exeDir;
const isPortable =
  fs.existsSync(path.join(exeDir, 'portable.marker')) ||
  fs.existsSync(path.join(installRoot, 'portable.marker'));

function resolveUserDir(): string {
  if (!isPacked && process.env.NOVA_DESKTOP !== '1') return process.cwd();
  if (isPortable) return installRoot;
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'NOVA AI Cloud');
  }
  return path.join(os.homedir(), '.config', 'nova-ai-cloud');
}

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

/** Tiny KEY=VALUE loader; never overrides a real environment variable. */
function loadEnvFile(dir: string) {
  for (const name of ['nova.env', '.env']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
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

const userDir = resolveUserDir();
try {
  fs.mkdirSync(userDir, { recursive: true });
} catch {
  /* handled downstream if read-only */
}

// Seamless migration from older sidecar-local files so upgrades lose nothing.
if (userDir !== exeDir && process.env.NOVA_DATA_DIR === undefined) {
  try {
    const targetEnv = path.join(userDir, 'nova.env');
    if (!fs.existsSync(targetEnv) && !fs.existsSync(path.join(userDir, '.env'))) {
      for (const candidate of [
        path.join(exeDir, 'nova.env'),
        path.join(exeDir, '.env'),
        path.join(installRoot, 'nova.env'),
        path.join(installRoot, '.env'),
      ]) {
        if (fs.existsSync(candidate)) {
          fs.copyFileSync(candidate, targetEnv);
          console.log(`[nova-sidecar] migrated config from ${candidate} -> ${targetEnv}`);
          break;
        }
      }
    }
    const legacyData = path.join(exeDir, 'nova-data');
    const targetData = path.join(userDir, 'nova-data');
    if (
      fs.existsSync(path.join(legacyData, 'nova-store.json')) &&
      !fs.existsSync(path.join(targetData, 'nova-store.json'))
    ) {
      copyDirRecursive(legacyData, targetData);
      console.log(`[nova-sidecar] migrated user data from ${legacyData} -> ${targetData}`);
    }
  } catch (err) {
    console.warn('[nova-sidecar] migration skipped:', err);
  }
}

loadEnvFile(userDir);
if (installRoot !== userDir) loadEnvFile(installRoot);
if (exeDir !== userDir && exeDir !== installRoot) loadEnvFile(exeDir);
if (process.cwd() !== userDir) loadEnvFile(process.cwd());

const PORT = Number(process.env.PORT ?? 8787);
// Loopback only: a desktop app must not expose its API to the LAN by default.
const HOST = process.env.HOST ?? '127.0.0.1';
if (process.env.NOVA_DATA_DIR === undefined) process.env.NOVA_DATA_DIR = path.join(userDir, 'nova-data');
if (process.env.NOVA_ENV_FILE === undefined) process.env.NOVA_ENV_FILE = path.join(userDir, 'nova.env');
if (process.env.NOVA_SANDBOX === undefined) process.env.NOVA_SANDBOX = 'worker';

/**
 * Zero-capability V8 VM isolate for Desktop JavaScript execution & verification.
 * Has NO access to require, process, fs, network, or secrets, and enforces V8 CPU timeouts.
 */
function createLocalVmSandboxBinding() {
  return {
    async fetch(_input: Request | string, init?: RequestInit): Promise<Response> {
      const started = Date.now();
      let req: { code?: string; language?: string; files?: Record<string, string>; timeoutMs?: number } = {};
      try {
        req = JSON.parse(String(init?.body ?? '{}'));
      } catch {
        return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
      }
      const code = String(req.code ?? '');
      if (!code.trim()) {
        return Response.json({ ok: false, stdout: '', stderr: 'empty code', exitCode: 1, durationMs: 0, truncated: false });
      }
      if (req.language && !['javascript', 'js'].includes(req.language)) {
        return Response.json({
          ok: false,
          stdout: '',
          stderr: `Language "${req.language}" requires an external container sandbox (NOVA_SANDBOX=http); built-in desktop isolate runs JavaScript only.`,
          exitCode: 1,
          durationMs: Date.now() - started,
          truncated: false,
        });
      }

      const lines: string[] = [];
      let truncated = false;
      const push = (prefix: string, args: unknown[]) => {
        const msg = args
          .map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
          .join(' ');
        const total = lines.reduce((n, l) => n + l.length, 0);
        if (total > 64_000) {
          truncated = true;
          return;
        }
        lines.push(`${prefix}${msg}`);
      };

      const timeoutMs = Math.min(Math.max(req.timeoutMs ?? 5000, 100), 15000);
      const sandboxGlobal = Object.freeze({
        console: Object.freeze({
          log: (...a: unknown[]) => push('[out]', a),
          info: (...a: unknown[]) => push('[out]', a),
          debug: (...a: unknown[]) => push('[out]', a),
          warn: (...a: unknown[]) => push('[err]', a),
          error: (...a: unknown[]) => push('[err]', a),
        }),
        files: Object.freeze({ ...(req.files ?? {}) }),
        TextEncoder,
        TextDecoder,
      });

      let ok = true;
      let errText = '';
      try {
        const ctx = vm.createContext(sandboxGlobal, {
          name: 'nova-vm-isolate',
          codeGeneration: { strings: false, wasm: false },
        });
        const script = new vm.Script(`"use strict";\n(async () => {\n${code}\n})()`, { filename: 'sandbox.js' });
        const out = script.runInContext(ctx, { timeout: timeoutMs });
        if (out && typeof (out as Promise<unknown>).then === 'function') {
          await Promise.race([
            out as Promise<unknown>,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)),
          ]);
        }
      } catch (err) {
        ok = false;
        errText = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }

      const stdout = lines.filter((l) => l.startsWith('[out]')).map((l) => l.slice(5)).join('\n');
      const stderr = [...lines.filter((l) => l.startsWith('[err]')).map((l) => l.slice(5)), ...(errText ? [errText] : [])].join('\n');
      return Response.json({
        ok,
        stdout,
        stderr,
        exitCode: ok ? 0 : 1,
        durationMs: Date.now() - started,
        truncated,
      });
    },
  };
}

function envFromProcess(): RawEnv {
  const env: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.NOVA_RUNTIME = 'node';
  if (env.NOVA_SANDBOX === 'worker' && !env.SANDBOX) {
    env.SANDBOX = createLocalVmSandboxBinding();
  }
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
