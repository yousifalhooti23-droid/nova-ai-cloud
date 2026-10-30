/**
 * Command policy for the terminal tool.
 *
 * Two layers of defence:
 *   1. Execution never happens in the API Worker (see src/sandbox).
 *   2. Even inside a sandbox, obviously destructive commands are refused,
 *      because an http sandbox may be a real container with a mounted volume.
 *
 * The list is intentionally conservative and explicit — no clever parsing.
 */
export type CommandRisk = 'safe' | 'needs-approval' | 'blocked';

interface Rule {
  re: RegExp;
  risk: CommandRisk;
  rule: string;
  reason: string;
}

const RULES: Rule[] = [
  { re: /\brm\s+(-[a-z]*\s+)*-?[a-z]*[rf]/i, risk: 'blocked', rule: 'rm-recursive', reason: 'recursive delete is blocked' },
  { re: /\bmkfs\b|\bdd\s+if=.*of=\/dev\//i, risk: 'blocked', rule: 'disk-destroy', reason: 'disk-level writes are blocked' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/i, risk: 'blocked', rule: 'pipe-to-shell', reason: 'piping a remote script into a shell is blocked' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, risk: 'blocked', rule: 'host-control', reason: 'host power commands are blocked' },
  { re: /\bchmod\s+(-R\s+)?777\b/i, risk: 'blocked', rule: 'chmod-777', reason: 'world-writable permissions are blocked' },
  { re: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/, risk: 'blocked', rule: 'fork-bomb', reason: 'fork bomb is blocked' },
  { re: /\bgit\s+push\b.*(--force|-f)\b/i, risk: 'needs-approval', rule: 'force-push', reason: 'force push rewrites remote history' },
  { re: /\bnpm\s+(publish|unpublish)\b/i, risk: 'needs-approval', rule: 'npm-publish', reason: 'publishing to a registry is irreversible' },
  { re: /\bgit\s+reset\s+--hard\b/i, risk: 'needs-approval', rule: 'git-reset-hard', reason: 'hard reset discards local work' },
  { re: /\b(sudo|su)\b/i, risk: 'needs-approval', rule: 'privilege-escalation', reason: 'privilege escalation' },
  { re: /\b(curl|wget|nc|ncat|ssh|scp)\b/i, risk: 'needs-approval', rule: 'network', reason: 'outbound network access' },
  { re: /\b(npm|pnpm|yarn)\s+(i|install|add|ci)\b/i, risk: 'needs-approval', rule: 'install-deps', reason: 'installing dependencies fetches and runs third-party code' },
];

export interface CommandVerdict {
  risk: CommandRisk;
  rule: string | null;
  reason: string;
}

export function classifyCommand(command: string): CommandVerdict {
  const cmd = command.trim();
  if (!cmd) return { risk: 'blocked', rule: 'empty', reason: 'empty command' };
  if (cmd.length > 4000) return { risk: 'blocked', rule: 'too-long', reason: 'command is longer than 4000 characters' };
  for (const rule of RULES) {
    if (rule.re.test(cmd)) return { risk: rule.risk, rule: rule.rule, reason: rule.reason };
  }
  return { risk: 'safe', rule: null, reason: 'no policy rule matched' };
}

/**
 * Which tools may run without pausing for the user.
 * `proposal` tools never write directly — they create a change the user approves.
 */
export const TOOL_RISK = {
  read_file: 'read-only',
  list_files: 'read-only',
  search_project: 'read-only',
  git_status: 'read-only',
  git_diff: 'read-only',
  git_log: 'read-only',
  verify_code: 'read-only',
  read_memory: 'read-only',
  write_file: 'proposal',
  edit_file: 'proposal',
  delete_file: 'proposal',
  write_memory: 'proposal',
  plan_tasks: 'proposal',
  update_task: 'proposal',
  run_command: 'needs-approval',
  git_commit: 'needs-approval',
} as const;
