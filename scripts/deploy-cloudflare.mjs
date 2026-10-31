#!/usr/bin/env node
/**
 * NOVA AI Cloud — Zero-Config 100% Free Cloudflare Workers Deployer
 * =================================================================
 * Automatically provisions everything on Cloudflare's cardless Free Tier ($0):
 *   1. Verifies Wrangler auth (runs browser `wrangler login` if interactive & needed)
 *   2. Finds or creates the `nova-db` D1 SQLite database and injects its UUID
 *   3. Applies D1 SQLite schema migrations (`0001_init.sql`) remotely
 *   4. Builds the production React Web UI (`apps/web/dist`)
 *   5. Deploys the isolated zero-privilege `nova-sandbox` Worker
 *   6. Syncs optional `OPENROUTER_API_KEY` / `NOVA_ACCESS_TOKEN` secrets if set
 *   7. Deploys `nova-ai-cloud` (API + Web UI + Workers AI Flux + D1 Storage)
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = path.join(root, 'apps/worker');
const sandboxDir = path.join(root, 'sandbox/worker');
const wranglerBin = path.join(
  workerDir,
  'node_modules/.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd = root, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CI: 'true', ...extraEnv },
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

function capture(cmd, args, cwd = workerDir) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, CI: 'true' },
  });
}

console.log('🚀 NOVA AI Cloud — Preparing 100% Free Cloudflare Workers Deployment...');

// 1. Check auth
const whoami = capture(wranglerBin, ['whoami']);
if (whoami.status !== 0) {
  if (process.env.CI === 'true' || !process.stdin.isTTY) {
    console.error('❌ Not authenticated with Cloudflare. Set CLOUDFLARE_API_TOKEN or run `deploy-cloudflare.bat` locally once.');
    process.exit(1);
  }
  console.log('🔐 Opening browser to sign in to your free Cloudflare account...');
  const login = spawnSync(wranglerBin, ['login'], { cwd: workerDir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (login.status !== 0) process.exit(1);
}

// 2. Find or create D1 database `nova-db`
console.log('🗄️  Checking Cloudflare D1 database (nova-db)...');
let dbId = '';
const listRes = capture(wranglerBin, ['d1', 'list', '--json']);
if (listRes.status === 0 && listRes.stdout) {
  try {
    const parsed = JSON.parse(listRes.stdout);
    const hit = Array.isArray(parsed) ? parsed.find((d) => d.name === 'nova-db') : null;
    if (hit?.uuid) dbId = hit.uuid;
  } catch {
    /* ignore parse issues */
  }
}

if (!dbId) {
  console.log('✨ Creating free D1 database `nova-db`...');
  const createRes = capture(wranglerBin, ['d1', 'create', 'nova-db']);
  const combined = `${createRes.stdout ?? ''}\n${createRes.stderr ?? ''}`;
  const uuidMatch = combined.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) {
    dbId = uuidMatch[0];
  } else {
    // Re-check list in case it already existed
    const retry = capture(wranglerBin, ['d1', 'list', '--json']);
    if (retry.status === 0 && retry.stdout) {
      try {
        const hit = JSON.parse(retry.stdout).find((d) => d.name === 'nova-db');
        if (hit?.uuid) dbId = hit.uuid;
      } catch { /* ignore */ }
    }
  }
}

if (!dbId) {
  console.error('❌ Could not resolve D1 database UUID for `nova-db`.');
  process.exit(1);
}
console.log(`✅ D1 database ready: nova-db (${dbId})`);

// Patch wrangler.jsonc temporarily (or persistently locally) with real D1 UUID
const wranglerCfgPath = path.join(workerDir, 'wrangler.jsonc');
const originalCfg = readFileSync(wranglerCfgPath, 'utf8');
const patchedCfg = originalCfg.replace(/"database_id"\s*:\s*"[^"]+"/, `"database_id": "${dbId}"`);
writeFileSync(wranglerCfgPath, patchedCfg, 'utf8');

try {
  // 3. Apply remote D1 migrations
  console.log('📦 Applying D1 SQLite migrations...');
  run(wranglerBin, ['d1', 'migrations', 'apply', 'nova-db', '--remote'], workerDir);

  // 4. Build Web UI
  console.log('🎨 Building production Web UI...');
  run(npmCmd, ['run', 'build'], root);

  // 5. Deploy isolated sandbox Worker first
  console.log('🛡️  Deploying isolated sandbox Worker (nova-sandbox)...');
  const sandboxWrangler = path.join(
    sandboxDir,
    'node_modules/.bin',
    process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
  );
  run(sandboxWrangler, ['deploy'], sandboxDir);

  // 6. Push optional secrets if supplied in environment
  for (const secretName of ['OPENROUTER_API_KEY', 'NOVA_ACCESS_TOKEN']) {
    const val = process.env[secretName]?.trim();
    if (val) {
      console.log(`🔑 Configuring secret ${secretName}...`);
      spawnSync(wranglerBin, ['secret', 'put', secretName], {
        cwd: workerDir,
        input: val,
        stdio: ['pipe', 'inherit', 'inherit'],
        shell: process.platform === 'win32',
      });
    }
  }

  // 7. Deploy main NOVA AI Cloud Worker
  console.log('☁️  Deploying NOVA AI Cloud Worker...');
  const deployOut = execSync(`"${wranglerBin}" deploy`, {
    cwd: workerDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true' },
  });
  process.stdout.write(deployOut);
  const urlMatch = deployOut.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
  if (urlMatch) {
    console.log(`\n🎉 LIVE CLOUD URL: ${urlMatch[0]}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### 🎉 تم نشر NOVA AI Cloud مجاناً على Cloudflare Workers!\n\n- **الرابط المباشر للموقع:** ${urlMatch[0]}\n- **قاعدة البيانات (D1):** \`nova-db\` (\`${dbId}\`)\n`,
        { flag: 'a' },
      );
    }
  }
} finally {
  // In GitHub Actions keep repo working tree clean; locally keep real UUID if user wants
  if (process.env.GITHUB_ACTIONS === 'true') {
    writeFileSync(wranglerCfgPath, originalCfg, 'utf8');
  }
}
