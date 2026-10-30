/**
 * Self-test for scripts/sandbox-reference-server.mjs.
 *
 * Boots the reference server on a spare port with a test token and checks the
 * behaviours NOVA depends on: auth, shell/JS execution, file mounts, honest
 * non-zero exits, timeout enforcement and explicit refusal of unsupported
 * languages. Run it with: node scripts/sandbox-selftest.mjs
 */
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['scripts/sandbox-reference-server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, NOVA_SANDBOX_PORT: '8799', NOVA_SANDBOX_TOKEN: 'test-token' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (d) => { logs += d; });
child.stderr.on('data', (d) => { logs += d; });

const base = 'http://127.0.0.1:8799';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1200);

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

try {
  // health is open
  const h = await (await fetch(`${base}/health`)).json();
  check('health reports no isolation', h.isolation?.includes('NONE'), JSON.stringify(h));

  // auth enforced
  const noAuth = await fetch(`${base}/exec`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'echo hi' }) });
  check('rejects missing token', noAuth.status === 401, `status=${noAuth.status}`);

  const post = (body) => fetch(`${base}/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  // shell
  const sh = await post({ command: 'echo hello && pwd && ls', language: 'shell', timeoutMs: 10000 });
  check('shell runs', sh.ok && sh.stdout.includes('hello'), JSON.stringify(sh).slice(0, 200));
  check('shell exit code', sh.exitCode === 0, `exit=${sh.exitCode}`);

  // shell failure surfaces stderr + non-zero exit
  const bad = await post({ command: 'echo oops >&2; exit 3', language: 'shell' });
  check('non-zero exit reported honestly', bad.ok === false && bad.exitCode === 3 && bad.stderr.includes('oops'), JSON.stringify(bad).slice(0, 200));

  // javascript
  const js = await post({ code: 'console.log("sum=" + (2+3));', language: 'javascript' });
  check('javascript runs', js.ok && js.stdout.includes('sum=5'), JSON.stringify(js).slice(0, 200));

  // file mounts
  const mounted = await post({ code: 'import { readFileSync } from "node:fs"; console.log(readFileSync("data/note.txt","utf8"));', language: 'javascript', files: { 'data/note.txt': 'mounted-ok' } });
  check('files are mounted', mounted.ok && mounted.stdout.includes('mounted-ok'), JSON.stringify(mounted).slice(0, 220));

  // timeout kills the process
  const t0 = Date.now();
  const slow = await post({ command: 'sleep 30', language: 'shell', timeoutMs: 1500 });
  check('timeout enforced', slow.ok === false && Date.now() - t0 < 6000 && /killed after/.test(slow.stderr), `${JSON.stringify(slow).slice(0,160)} in ${Date.now() - t0}ms`);

  // unsupported language is explicit
  const ruby = await post({ code: 'puts 1', language: 'ruby' });
  check('unsupported language refused', ruby.ok === false && /Unsupported language/.test(ruby.stderr), JSON.stringify(ruby).slice(0, 160));

  // typescript without esbuild reports honestly (esbuild may exist here)
  const ts = await post({ code: 'const x: number = 41; console.log(x + 1);', language: 'typescript' });
  check('typescript runs or explains', ts.ok ? ts.stdout.includes('42') : /esbuild|tsx/.test(ts.stderr), JSON.stringify(ts).slice(0, 200));
} finally {
  child.kill('SIGTERM');
  await wait(300);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('--- server logs ---\n' + logs); process.exit(1); }
