#!/usr/bin/env node
/**
 * NOVA reference sandbox server
 * =============================
 *
 * Implements the external sandbox contract that `NOVA_SANDBOX=http` expects:
 *
 *   POST /exec   { command?, code?, language?, files?, projectId?, timeoutMs? }
 *                -> { ok, stdout, stderr, exitCode, durationMs, truncated }
 *   GET  /health -> { ok, kind, capabilities, isolation }
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  THIS PROCESS PROVIDES *NO* ISOLATION BY ITSELF.                       │
 * │  It spawns real child processes with the privileges of whatever user   │
 * │  runs it. Only start it inside a disposable container / microVM /      │
 * │  throwaway VM that has no credentials, no network access to your       │
 * │  internal services, and nothing you care about.                        │
 * │                                                                        │
 * │  Example (Docker, no network, read-only root, memory + pid caps):      │
 * │    docker run --rm -it --network none --read-only --tmpfs /tmp \        │
 * │      --memory 512m --pids-limit 128 --cap-drop ALL \                    │
 * │      -v "$PWD/scripts:/srv:ro" -e NOVA_SANDBOX_TOKEN=dev-only \         │
 * │      -w /srv node:20-alpine node sandbox-reference-server.mjs           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Environment:
 *   NOVA_SANDBOX_TOKEN   required unless ALLOW_NO_AUTH=true (shared secret)
 *   NOVA_SANDBOX_PORT    default 8790
 *   NOVA_SANDBOX_HOST    default 0.0.0.0
 *   NOVA_SANDBOX_TIMEOUT default 30000 ms (hard cap 120000)
 *   ALLOW_NO_AUTH        "true" only for a local throwaway container
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const TOKEN = process.env.NOVA_SANDBOX_TOKEN ?? '';
const ALLOW_NO_AUTH = process.env.ALLOW_NO_AUTH === 'true';
const PORT = Number(process.env.NOVA_SANDBOX_PORT ?? 8790);
const HOST = process.env.NOVA_SANDBOX_HOST ?? '0.0.0.0';
const DEFAULT_TIMEOUT = Math.min(Number(process.env.NOVA_SANDBOX_TIMEOUT ?? 30_000), 120_000);
const MAX_OUTPUT = 20_000;

const CAPABILITIES = ['shell commands', 'javascript', 'typescript', 'python', 'file mounts', 'build/test runners'];

if (!TOKEN && !ALLOW_NO_AUTH) {
  console.error('[nova-sandbox] refusing to start: set NOVA_SANDBOX_TOKEN (or ALLOW_NO_AUTH=true inside a disposable container).');
  process.exit(1);
}

console.warn(`
┌──────────────────────────────────────────────────────────────────────┐
│  NOVA reference sandbox — NO ISOLATION OF ITS OWN.                   │
│  Run this only inside a disposable container/microVM.                │
│  Commands execute as the current user with its full privileges.      │
└──────────────────────────────────────────────────────────────────────┘
`);

/* ------------------------------------------------------------------ helpers */

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function truncate(text) {
  if (typeof text !== 'string') return { text: '', truncated: false };
  if (text.length <= MAX_OUTPUT) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_OUTPUT)}\n…[truncated ${text.length - MAX_OUTPUT} chars]`, truncated: true };
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authorized(req) {
  if (ALLOW_NO_AUTH && !TOKEN) return true;
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return Boolean(TOKEN) && token === TOKEN;
}

/** Write mounted files into a fresh temp dir, refusing path traversal. */
async function mountFiles(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-sbx-'));
  for (const [rawPath, content] of Object.entries(files ?? {})) {
    const rel = String(rawPath).replace(/^\/+/, '');
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) continue;
    const target = path.join(dir, rel);
    if (!target.startsWith(dir)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof content === 'string' ? content : String(content), 'utf8');
  }
  return dir;
}

/**
 * Run one command with a hard timeout; never throws on non-zero exit.
 *
 * The child is spawned detached so it gets its own process group: killing the
 * group is what actually stops `sh -c "sleep 30"`. Killing only the shell
 * would leave the grandchild holding the stdout/stderr pipes open, and the
 * 'close' event would not fire until the command finished on its own.
 */
function run(cmd, args, { cwd, timeoutMs, env = {} }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let killed = false;
    let settled = false;

    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { PATH: process.env.PATH, HOME: cwd, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: `spawn failed: ${err.message}`, exitCode: null, durationMs: 0, truncated: false });
      return;
    }

    const killTree = () => {
      if (process.platform === 'win32' || child.pid === undefined) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        return;
      }
      try { process.kill(-child.pid, 'SIGKILL'); } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      if (killed) stderr += `\n[killed after ${timeoutMs}ms timeout]`;
      const out = truncate(stdout);
      const err = truncate(stderr);
      resolve({
        ok: code === 0 && !killed,
        stdout: out.text,
        stderr: err.text,
        exitCode: code,
        durationMs: Date.now() - started,
        truncated: out.truncated || err.truncated,
      });
    };

    const timer = setTimeout(() => {
      killed = true;
      killTree();
    }, timeoutMs);

    // Last resort: if the pipes never close, answer anyway so callers are not
    // left hanging past the timeout they asked for.
    const hardStop = setTimeout(() => {
      killTree();
      finish(killed ? null : 124);
    }, timeoutMs + 3000);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      stderr = `${stderr}\n${err.message}`.trim();
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

async function which(binary) {
  const res = await run('sh', ['-c', `command -v ${binary}`], { cwd: tmpdir(), timeoutMs: 5_000 });
  return res.ok ? res.stdout.trim() : null;
}

/* --------------------------------------------------------------------- exec */

async function exec(payload) {
  const language = String(payload.language ?? (payload.command ? 'shell' : 'javascript')).toLowerCase();
  const timeoutMs = Math.min(Number(payload.timeoutMs ?? DEFAULT_TIMEOUT) || DEFAULT_TIMEOUT, 120_000);
  const workdir = await mountFiles(payload.files);
  const started = Date.now();

  try {
    /* ---- shell command (what the terminal tool sends) ---- */
    if (payload.command && !payload.code) {
      const res = await run('sh', ['-c', String(payload.command)], { cwd: workdir, timeoutMs });
      return { ...res, adapter: 'reference-shell' };
    }

    /* ---- javascript ---- */
    if (language === 'javascript' || language === 'js') {
      const file = path.join(workdir, 'program.mjs');
      await writeFile(file, String(payload.code ?? ''), 'utf8');
      const res = await run(process.execPath, [file], { cwd: workdir, timeoutMs });
      return { ...res, adapter: 'reference-node' };
    }

    /* ---- typescript: transpile with esbuild when available, else say so ---- */
    if (language === 'typescript' || language === 'ts') {
      const src = path.join(workdir, 'program.ts');
      await writeFile(src, String(payload.code ?? ''), 'utf8');
      const esbuild = await which('esbuild');
      if (!esbuild) {
        return {
          ok: false,
          stdout: '',
          stderr: 'TypeScript execution needs esbuild (or tsx) inside the sandbox image. Install it there, or send JavaScript.',
          exitCode: null,
          durationMs: Date.now() - started,
          truncated: false,
          adapter: 'reference-unavailable',
        };
      }
      const out = path.join(workdir, 'program.mjs');
      const transpile = await run(esbuild, [src, `--outfile=${out}`, '--format=esm', '--platform=node', '--target=node20'], { cwd: workdir, timeoutMs });
      if (!transpile.ok) return { ...transpile, adapter: 'reference-esbuild' };
      const res = await run(process.execPath, [out], { cwd: workdir, timeoutMs });
      return { ...res, adapter: 'reference-esbuild' };
    }

    /* ---- python ---- */
    if (language === 'python' || language === 'py') {
      const py = (await which('python3')) ?? (await which('python'));
      if (!py) {
        return { ok: false, stdout: '', stderr: 'python3 is not installed in this sandbox image.', exitCode: null, durationMs: Date.now() - started, truncated: false, adapter: 'reference-unavailable' };
      }
      const file = path.join(workdir, 'program.py');
      await writeFile(file, String(payload.code ?? ''), 'utf8');
      const res = await run(py, [file], { cwd: workdir, timeoutMs });
      return { ...res, adapter: 'reference-python' };
    }

    return {
      ok: false,
      stdout: '',
      stderr: `Unsupported language: ${language}. Supported: shell, javascript, typescript, python.`,
      exitCode: null,
      durationMs: Date.now() - started,
      truncated: false,
      adapter: 'reference-unavailable',
    };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  const id = randomUUID().slice(0, 8);
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      kind: 'http',
      version: '0.1.0',
      capabilities: CAPABILITIES,
      isolation: 'NONE from this process — it must run inside a disposable container/microVM.',
      auth: TOKEN ? 'bearer token required' : 'DISABLED (ALLOW_NO_AUTH)',
    });
  }

  if (url.pathname === '/exec' && req.method === 'POST') {
    if (!authorized(req)) return send(res, 401, { ok: false, error: 'unauthorized', stdout: '', stderr: '', exitCode: null, durationMs: 0 });
    let payload;
    try {
      payload = JSON.parse(await readBody(req) || '{}');
    } catch (err) {
      return send(res, 400, { ok: false, error: `invalid JSON body: ${err.message}`, stdout: '', stderr: '', exitCode: null, durationMs: 0 });
    }
    try {
      const result = await exec(payload);
      console.log(`[nova-sandbox ${id}] ${payload.language ?? 'shell'} ok=${result.ok} ${result.durationMs}ms`);
      return send(res, 200, result);
    } catch (err) {
      console.error(`[nova-sandbox ${id}] failed`, err);
      return send(res, 500, { ok: false, error: err.message, stdout: '', stderr: '', exitCode: null, durationMs: 0, truncated: false });
    }
  }

  return send(res, 404, { ok: false, error: `no route for ${req.method} ${url.pathname}`, stdout: '', stderr: '', exitCode: null, durationMs: 0 });
});

server.listen(PORT, HOST, () => {
  console.log(`[nova-sandbox] listening on http://${HOST}:${PORT} (auth: ${TOKEN ? 'bearer' : 'DISABLED'})`);
  console.log('[nova-sandbox] POST /exec · GET /health');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[nova-sandbox] ${signal} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
