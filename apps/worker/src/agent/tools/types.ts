import type { ServerEvent, ToolDescriptor } from '@nova/shared';
import type { NovaConfig } from '../../env.js';
import type { Logger } from '../../lib/log.js';
import type { SandboxAdapter } from '../../sandbox/types.js';
import type { Store } from '../../storage/types.js';
import type { GitService } from '../git.js';

export interface ToolContext {
  store: Store;
  git: GitService;
  sandbox: SandboxAdapter;
  cfg: NovaConfig;
  projectId: string;
  runId: string;
  autoApply: boolean;
  allowTerminal: boolean;
  log: Logger;
  emit: (evt: ServerEvent) => void;
  recordEvent: (type: string, payload: unknown) => Promise<void>;
}

export interface ToolResult {
  ok: boolean;
  /** Text returned to the model. Must be self-contained and bounded in size. */
  output: string;
  meta?: Record<string, unknown>;
}

export interface Tool {
  descriptor: ToolDescriptor;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/* -------------------------------------------------------------- arg helpers */

export function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  return typeof v === 'string' ? v : String(v);
}

export function reqStr(args: Record<string, unknown>, key: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = strArg(args, key);
  if (v === undefined || v.trim() === '') return { ok: false, error: `missing required argument "${key}"` };
  return { ok: true, value: v };
}

export function boolArg(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
}

export function numArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* --------------------------------------------------------------- path rules */

/** Paths the agent may never create or modify — they hold secrets or build junk. */
const PROTECTED_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^\.dev\.vars$/i,
  /(^|\/)\.git\//i,
  /(^|\/)node_modules\//i,
  /(^|\/)\.wrangler\//i,
  /(^|\/)dist\//i,
];

export interface PathCheck {
  ok: boolean;
  path?: string;
  error?: string;
}

export function checkPath(raw: string | undefined, opts: { write?: boolean } = {}): PathCheck {
  if (!raw || !raw.trim()) return { ok: false, error: 'path is required' };
  const path = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path) return { ok: false, error: 'path is required' };
  if (path.split('/').some((seg) => seg === '..')) return { ok: false, error: `path traversal is not allowed: "${raw}"` };
  if (path.length > 400) return { ok: false, error: 'path is too long' };
  if (/[<>"|?*\x00-\x1f]/.test(path)) return { ok: false, error: `path contains invalid characters: "${path}"` };
  if (opts.write && PROTECTED_PATTERNS.some((re) => re.test(path))) {
    return { ok: false, error: `"${path}" is protected. NOVA never writes environment/secret files or dependency directories.` };
  }
  return { ok: true, path };
}

export const MAX_TOOL_OUTPUT = 16_000;

export function bounded(text: string, max = MAX_TOOL_OUTPUT): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n…[output truncated: ${text.length - max} more chars]`, truncated: true };
}

export function fail(error: string, meta?: Record<string, unknown>): ToolResult {
  return { ok: false, output: `ERROR: ${error}`, meta };
}

export function ok(output: string, meta?: Record<string, unknown>): ToolResult {
  const b = bounded(output);
  return { ok: true, output: b.text, meta: { ...meta, truncated: b.truncated } };
}
