#!/usr/bin/env node
/**
 * NOVA dev launcher
 * =================
 * Starts the two processes you need for local development, with prefixed logs:
 *
 *   [api]  wrangler dev  (Cloudflare Workers runtime, D1 + R2 emulated locally)
 *   [web]  vite          (React app, proxies /api -> the worker)
 *
 * Optional:
 *   --sandbox   also start scripts/sandbox-reference-server.mjs.
 *               It executes REAL commands with NO isolation of its own, so only
 *               use it inside a disposable container. See docs/SANDBOX.md.
 *
 * Env:
 *   NOVA_WORKER_PORT (default 8787)
 *   NOVA_WEB_PORT    (default 5173)
 *   NOVA_SANDBOX_PORT(default 8790)
 *
 * No dependencies: node:child_process only.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const withSandbox = args.includes('--sandbox');

const WORKER_PORT = Number(process.env.NOVA_WORKER_PORT ?? 8787);
const WEB_PORT = Number(process.env.NOVA_WEB_PORT ?? 5173);
const SANDBOX_PORT = Number(process.env.NOVA_SANDBOX_PORT ?? 8790);

const COLORS = { api: '\x1b[38;5;209m', web: '\x1b[38;5;111m', sbx: '\x1b[38;5;215m', reset: '\x1b[0m', dim: '\x1b[2m' };

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npx';
}

const children = [];
let shuttingDown = false;

function start(tag, color, command, cmdArgs, cwd, env = {}) {
  const child = spawn(command, cmdArgs, {
    cwd: path.join(root, cwd),
    env: { ...process.env, ...env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  children.push({ tag, child });

  const pipe = (stream, out) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        out.write(`${color}[${tag}]${COLORS.reset} ${line}\n`);
      }
    });
    stream.on('end', () => {
      if (buffer.trim()) out.write(`${color}[${tag}]${COLORS.reset} ${buffer}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stderr.write(`\n${color}[${tag}]${COLORS.reset} exited (code=${code} signal=${signal}) — shutting everything down\n`);
    shutdown(code ?? 1);
  });
  child.on('error', (err) => {
    process.stderr.write(`\n${color}[${tag}]${COLORS.reset} failed to start: ${err.message}\n`);
    shutdown(1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  }
  setTimeout(() => {
    for (const { child } of children) {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    process.exit(code);
  }, 1500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/* ---------------------------------------------------------------- preflight */

const workerDir = 'apps/worker';
const webDir = 'apps/web';
if (!existsSync(path.join(root, workerDir, 'node_modules')) && !existsSync(path.join(root, 'node_modules', 'wrangler'))) {
  process.stderr.write(`${COLORS.sbx}[dev]${COLORS.reset} dependencies missing — run: npm install\n`);
}
if (!existsSync(path.join(root, workerDir, '.dev.vars'))) {
  process.stderr.write(
    `${COLORS.sbx}[dev]${COLORS.reset} apps/worker/.dev.vars not found.\n` +
    `${COLORS.sbx}[dev]${COLORS.reset} copy .env.example and fill in what you need — the app runs without keys,\n` +
    `${COLORS.sbx}[dev]${COLORS.reset} but then no real model is reachable (the UI says so explicitly).\n`,
  );
}

process.stdout.write(`\n${COLORS.dim}NOVA AI Cloud — local development${COLORS.reset}\n`);
process.stdout.write(`${COLORS.dim}  web  → http://localhost:${WEB_PORT}${COLORS.reset}\n`);
process.stdout.write(`${COLORS.dim}  api  → http://localhost:${WORKER_PORT}/api/health${COLORS.reset}\n`);
if (withSandbox) {
  process.stdout.write(`${COLORS.sbx}  sandbox → http://localhost:${SANDBOX_PORT}  (NO ISOLATION — disposable container only)${COLORS.reset}\n`);
}
process.stdout.write(`${COLORS.dim}  stop everything with Ctrl+C\n\n${COLORS.reset}`);

/* ------------------------------------------------------------------ launch */

start('api', COLORS.api, npmCmd(), ['wrangler', 'dev', '--local', '--ip', '0.0.0.0', '--port', String(WORKER_PORT)], workerDir);

start('web', COLORS.web, npmCmd(), ['vite', '--host', '0.0.0.0', '--port', String(WEB_PORT)], webDir, {
  NOVA_WORKER_URL: `http://127.0.0.1:${WORKER_PORT}`,
});

if (withSandbox) {
  start('sbx', COLORS.sbx, process.execPath, [path.join(root, 'scripts/sandbox-reference-server.mjs')], '.', {
    NOVA_SANDBOX_PORT: String(SANDBOX_PORT),
    NOVA_SANDBOX_TOKEN: process.env.NOVA_SANDBOX_TOKEN ?? 'dev-only',
  });
}
