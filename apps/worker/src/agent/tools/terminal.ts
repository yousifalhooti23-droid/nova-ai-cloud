import { detectLanguage, isBinaryPath, truncate } from '@nova/shared';
import type { Tool, ToolContext } from './types.js';
import { fail, numArg, ok, reqStr, strArg } from './types.js';
import { classifyCommand } from '../permissions.js';

/* ------------------------------------------------------------- run_command */

export const runCommandTool: Tool = {
  descriptor: {
    name: 'run_command',
    description:
      'Execute a shell command in the isolated sandbox (never on the API server). Requires the user to enable terminal access for this run AND a configured sandbox. Returns stdout/stderr/exit code.',
    risk: 'needs-approval',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command, e.g. "npm test" or "node build.js"' },
        language: { type: 'string', enum: ['shell', 'javascript', 'python'], description: 'Default shell' },
        reason: { type: 'string', description: 'Why this command is needed' },
        timeoutMs: { type: 'integer', description: 'Default 20000' },
      },
      required: ['command'],
    },
  },
  async run(args, ctx) {
    const c = reqStr(args, 'command');
    if (!c.ok) return fail(c.error);
    if (!ctx.allowTerminal) {
      return fail(
        'Terminal access is disabled for this run. The user must enable "Allow terminal" (allowTerminal) before commands can be executed.',
        { allowTerminal: false },
      );
    }
    const status = ctx.sandbox.status();
    if (!status.ready) {
      return fail(`Sandbox is not available: ${status.detail}`, { sandbox: status.kind });
    }
    const verdict = classifyCommand(c.value);
    if (verdict.risk === 'blocked') {
      return fail(`Command blocked by policy: ${verdict.reason}`, { policy: verdict.rule });
    }
    if (verdict.risk === 'needs-approval') {
      ctx.log.warn('risky command executed under user opt-in', { command: truncate(c.value, 200), rule: verdict.rule });
      await ctx.recordEvent('command.risky', { command: c.value, rule: verdict.rule });
    }

    const files: Record<string, string> = {};
    for (const f of await ctx.store.listFiles(ctx.projectId)) {
      if (isBinaryPath(f.path) || f.sizeBytes > 200_000) continue;
      files[f.path] = f.content;
    }

    const started = Date.now();
    try {
      const res = await ctx.sandbox.exec({
        command: c.value,
        language: (strArg(args, 'language') ?? 'shell') as 'shell' | 'javascript' | 'python',
        files,
        projectId: ctx.projectId,
        timeoutMs: numArg(args, 'timeoutMs', 20000),
      });
      const body = [
        `$ ${c.value}`,
        `adapter: ${res.adapter}  exit: ${res.exitCode ?? 'n/a'}  ${res.durationMs}ms${res.truncated ? '  (output truncated)' : ''}`,
        res.stdout ? `\n--- stdout ---\n${truncate(res.stdout, 6000)}` : '',
        res.stderr ? `\n--- stderr ---\n${truncate(res.stderr, 4000)}` : '',
        res.ok ? '' : '\nThe command failed. Read the error, fix the code, and verify before retrying.',
      ]
        .filter(Boolean)
        .join('\n');
      return ok(body, { exitCode: res.exitCode, ok: res.ok, adapter: res.adapter, durationMs: Date.now() - started });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), { sandbox: status.kind });
    }
  },
};

/* ------------------------------------------------------------- verify_code */

interface Finding {
  severity: 'error' | 'warning' | 'info';
  line?: number;
  message: string;
}

export const verifyCodeTool: Tool = {
  descriptor: {
    name: 'verify_code',
    description:
      'Verify code WITHOUT executing it: JSON/YAML parse checks, bracket & quote balance, unresolved relative imports, and (when a sandbox is configured) a real syntax check. Always run this after writing or editing code, and report findings honestly.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project file to verify' },
        changeId: { type: 'string', description: 'Verify a pending change proposal instead of the applied file' },
        code: { type: 'string', description: 'Ad-hoc snippet to verify instead of a file' },
        language: { type: 'string', description: 'Override language detection' },
      },
    },
  },
  async run(args, ctx) {
    let path = strArg(args, 'path');
    let code = strArg(args, 'code') ?? '';
    let language = strArg(args, 'language');
    let verifyingProposal = false;
    const changeId = strArg(args, 'changeId');

    if (changeId) {
      const change = await ctx.store.getChange(changeId);
      if (!change) return fail(`change not found: ${changeId}`);
      path = change.path;
      code = change.after ?? '';
      language = language ?? detectLanguage(change.path);
      verifyingProposal = change.status === 'pending';
      if (change.kind === 'delete') return ok(`Nothing to verify: ${change.path} is proposed for deletion.`, { pass: true });
    } else if (path) {
      let file = await ctx.store.getFile(ctx.projectId, path);
      if (!file) {
        const pending = (await ctx.store.listChanges(ctx.projectId, 'pending')).filter((ch) => ch.path === path);
        const latest = pending[pending.length - 1];
        if (latest && latest.kind !== 'delete') {
          code = latest.after ?? '';
          verifyingProposal = true;
        } else {
          return fail(`file not found: ${path}`);
        }
      } else {
        code = file.content;
        language = language ?? file.language;
      }
      language = language ?? detectLanguage(path);
    } else if (!code) {
      return fail('provide "path", "changeId" or "code"');
    }
    language = language ?? detectLanguage(path ?? 'snippet.ts');

    const findings: Finding[] = [];
    const checks: string[] = [];

    /* ---- structural checks (always available, deterministic) ---- */
    checks.push('bracket/quote balance');
    findings.push(...balanceChecks(code));

    if (language === 'json' || path?.endsWith('.json')) {
      checks.push('JSON.parse');
      try {
        JSON.parse(code);
      } catch (err) {
        findings.push({ severity: 'error', message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    if (['typescript', 'javascript'].includes(language)) {
      checks.push('relative import resolution');
      findings.push(...(await importChecks(ctx, code, path ?? '', verifyingProposal)));
      // Real parse check for plain JS (no execution): `new Function` compiles the source.
      if (language === 'javascript') {
        checks.push('JS compile (no execution)');
        try {
          // eslint-disable-next-line no-new-func
          new Function(`"use strict";\n${stripImports(code)}`);
        } catch (err) {
          findings.push({ severity: 'error', message: `syntax error: ${err instanceof Error ? err.message : String(err)}` });
        }
      } else {
        findings.push({
          severity: 'info',
          message: 'TypeScript type-checking needs tsc. Enable a sandbox (NOVA_SANDBOX) and run "npx tsc --noEmit" via run_command for a real check.',
        });
      }
    }

    /* ---- optional sandbox syntax check ---- */
    const sandboxStatus = ctx.sandbox.status();
    if (sandboxStatus.ready && language === 'javascript' && code.length < 200_000) {
      checks.push(`sandbox syntax check (${sandboxStatus.kind})`);
      try {
        const res = await ctx.sandbox.exec({ code: `new Function(${JSON.stringify(code)}); console.log('parsed ok');`, language: 'javascript', timeoutMs: 5000 });
        if (!res.ok || res.stderr) findings.push({ severity: 'error', message: `sandbox: ${truncate(res.stderr || 'failed', 400)}` });
      } catch (err) {
        findings.push({ severity: 'warning', message: `sandbox check skipped: ${err instanceof Error ? err.message : String(err)}` });
      }
    } else if (!sandboxStatus.ready) {
      checks.push('sandbox: unavailable');
    }

    const errors = findings.filter((f) => f.severity === 'error');
    const warnings = findings.filter((f) => f.severity === 'warning');
    const infos = findings.filter((f) => f.severity === 'info');
    const lines = [
      `verify_code → ${path ?? 'snippet'} (${language})${verifyingProposal ? ' [PENDING PROPOSAL — not yet applied]' : ''}`,
      `checks run: ${checks.join(', ')}`,
      `result: ${errors.length === 0 ? 'PASS' : 'FAIL'} — ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`,
      ...(errors.length ? ['', 'errors:', ...errors.map((f) => `  ✗ ${f.line ? `line ${f.line}: ` : ''}${f.message}`)] : []),
      ...(warnings.length ? ['', 'warnings:', ...warnings.map((f) => `  ! ${f.line ? `line ${f.line}: ` : ''}${f.message}`)] : []),
      ...(infos.length ? ['', 'notes:', ...infos.map((f) => `  · ${f.message}`)] : []),
    ];
    return ok(lines.join('\n'), { pass: errors.length === 0, errors: errors.length, warnings: warnings.length, checks, proposal: verifyingProposal });
  },
};

function stripImports(code: string): string {
  return code
    .split('\n')
    .filter((l) => !/^\s*(import|export)\s/.test(l))
    .join('\n');
}

function balanceChecks(code: string): Finding[] {
  const findings: Finding[] = [];
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closers = new Set(Object.values(pairs));
  const stack: { ch: string; line: number }[] = [];
  let inString: string | null = null;
  let inTemplate = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let line = 1;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === '\n') {
      line++;
      inLineComment = false;
      continue;
    }
    if (inLineComment) continue;
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '`') { inTemplate++; continue; }
    if (pairs[ch]) stack.push({ ch, line });
    else if (closers.has(ch)) {
      const top = stack.pop();
      if (!top) findings.push({ severity: 'error', line, message: `unexpected closing "${ch}"` });
      else if (pairs[top.ch] !== ch) findings.push({ severity: 'error', line, message: `mismatched brackets: "${top.ch}" opened on line ${top.line} closed by "${ch}"` });
    }
  }
  if (stack.length) {
    const t = stack[stack.length - 1];
    findings.push({ severity: 'error', line: t.line, message: `unclosed "${t.ch}"` });
  }
  if (inString) findings.push({ severity: 'error', message: 'unterminated string literal' });
  if (inBlockComment) findings.push({ severity: 'error', message: 'unterminated block comment' });
  void inTemplate;
  return findings;
}

async function importChecks(ctx: ToolContext, code: string, currentPath: string, allowPending = false): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await ctx.store.listFiles(ctx.projectId);
  const known = new Set(files.map((f) => f.path));
  if (allowPending) {
    // A proposal may import a file that is itself only proposed — count those as known.
    for (const ch of await ctx.store.listChanges(ctx.projectId, 'pending')) {
      if (ch.kind !== 'delete') known.add(ch.path);
    }
  }
  const re = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  const dir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : '';
  while ((m = re.exec(code)) !== null) {
    const spec = m[1];
    const base = resolveRelative(dir, spec);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.json`, `${base}/index.ts`, `${base}/index.js`];
    if (!candidates.some((c) => known.has(c))) {
      const line = code.slice(0, m.index).split('\n').length;
      findings.push({ severity: 'error', line, message: `unresolved relative import "${spec}" → none of ${candidates.slice(0, 3).join(', ')} exist in the project` });
    }
  }
  return findings;
}

function resolveRelative(dir: string, spec: string): string {
  const parts = dir ? dir.split('/') : [];
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export const terminalTools: Tool[] = [runCommandTool, verifyCodeTool];
