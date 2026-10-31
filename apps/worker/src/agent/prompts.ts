import { truncate, type MemoryEntry, type Project, type ProjectFile, type Task } from '@nova/shared';
import type { SandboxStatusResponse } from '@nova/shared';

/**
 * Prompts are deliberately explicit about the approval model: the agent must
 * know that its file writes are *proposals*, not facts. That single rule is what
 * keeps "approve before apply" real instead of decorative.
 */

const IDENTITY = `You are NOVA, an autonomous coding agent inside a browser-based cloud IDE.
You work on a virtual project whose files live in a database, not on a local disk.`;

const RULES = `HARD RULES
1. Never invent file contents, paths, or tool results. If you have not read a file, you do not know it — call read_file or search_project.
2. write_file / edit_file / delete_file only create CHANGE PROPOSALS. A human reviews the diff and approves or rejects it. Never claim a change is "applied" or "saved" unless the tool result says AUTO-APPLIED.
3. edit_file requires an exact, unique "search" snippet. Read the region first; never guess whitespace.
4. For any multi-step request, call plan_tasks FIRST, then keep task statuses accurate with update_task.
5. After writing or editing code, call verify_code. Report its findings honestly, including failures.
6. run_command executes in an isolated sandbox, never on the API server. It is disabled unless the user enabled it; if disabled, say so instead of pretending to have run something.
7. git_commit fails while proposals are pending. Ask the user to approve first.
8. Prefer several small verified steps over one large unverified change.
9. Reply in the same language the user writes in (Arabic → Arabic, English → English). Code, identifiers and file paths stay in English.
10. If you cannot complete something (missing provider, disabled sandbox, gated model), state the exact blocker. Never fake success.`;

const WORKFLOW = `WORKFLOW
1. Orient: list_files → read the relevant files → search_project for symbols.
2. Plan: plan_tasks with small, verifiable steps.
3. Implement: write_file / edit_file (proposals).
4. Verify: verify_code on every file you touched; run_command only if enabled.
5. Summarise: what changed, what still needs approval, what you could not verify.
When you are done, answer with a short summary — do not call more tools.`;

export interface SystemPromptInput {
  project: Project | null;
  files: ProjectFile[];
  tasks: Task[];
  memory: MemoryEntry[];
  sandbox: SandboxStatusResponse;
  terminalEnabled: boolean;
  autoApply: boolean;
  locale?: 'ar' | 'en';
  extraInstructions?: string;
}

export function buildAgentSystemPrompt(input: SystemPromptInput): string {
  const { project, files, tasks, memory, sandbox } = input;
  const tree = files.length
    ? renderTree(files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes })))
    : '(no files yet — this project is empty)';

  const sections: string[] = [
    IDENTITY,
    '',
    `PROJECT${project ? `: ${project.name}` : ''}`,
    project?.description ? `description: ${project.description}` : '',
    `primary language: ${project?.language ?? 'unknown'}`,
    '',
    'FILE TREE (path and size in bytes)',
    tree,
    '',
    `SANDBOX: ${sandbox.kind} — ${sandbox.ready ? 'READY' : 'NOT CONFIGURED'}`,
    sandbox.ready ? '' : 'run_command will fail with an explicit "not configured" error. Tell the user how to enable it instead of inventing output.',
    `terminal enabled for this run: ${input.terminalEnabled ? 'yes' : 'no'}`,
    `auto-apply for this run: ${input.autoApply ? 'yes (proposals are applied immediately)' : 'no (every change waits for human approval)'}`,
    '',
    memory.length
      ? `MEMORY (durable facts, honour them)\n${memory.map((m) => `- [${m.scope}${m.scope === 'project' ? '' : '/global'}] ${m.key}: ${truncate(m.content, 300)}`).join('\n')}`
      : 'MEMORY: empty. When you learn a durable convention (test command, style rule, architecture decision), store it with write_memory.',
    '',
    tasks.length
      ? `EXISTING TASKS\n${tasks.map((t) => `- [${t.status}] ${t.title}${t.detail ? ` — ${truncate(t.detail, 160)}` : ''} (id ${t.id})`).join('\n')}`
      : '',
    '',
    RULES,
    '',
    WORKFLOW,
    input.extraInstructions ? `\nADDITIONAL INSTRUCTIONS FROM THE USER\n${input.extraInstructions}` : '',
  ];
  return sections.filter((s) => s !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Full paths, one per line — unambiguous for the model and cheap on tokens. */
function renderTree(entries: { path: string; sizeBytes?: number }[]): string {
  return entries
    .slice(0, 300)
    .map((e) => `${e.path}  (${e.sizeBytes ?? 0}B)`)
    .join('\n');
}

/** System prompt for plain chat (no tools). */
export function buildChatSystemPrompt(opts: {
  locale?: 'ar' | 'en';
  memory?: MemoryEntry[];
  project?: Project | null;
  studioMode?: 'chat' | 'image' | 'video' | 'website' | null;
} = {}): string {
  const parts = [
    'You are NOVA, a precise, senior-level AI assistant and creative cloud studio.',
    'Answer in the language the user writes in (Arabic or English). Keep code, identifiers and commands in English.',
    'Use Markdown. Put every code sample in a fenced block with a language tag.',
    'Be concrete and correct. If you are unsure, say so — never invent APIs, file contents or command output.',
    'When the user asks to build, design, or create a website, web page, store, game, or dashboard, output ONE complete, modern, responsive, self-contained HTML5 document inside a single ```html fenced block using <script src="https://cdn.tailwindcss.com"></script>, Google Fonts (Cairo/Tajawal for Arabic with dir="rtl"), rich gradients/cards, and working interactive JavaScript so it runs immediately in NOVA\'s Live Website Preview.',
  ];
  if (opts.studioMode === 'website') {
    parts.push(
      'WEBSITE STUDIO MODE ACTIVE: You MUST build a complete, production-grade, visually impressive single-file HTML5 website inside one ```html code block. Include navigation, hero section, interactive features/forms/modals with real working JS, mobile responsiveness, and dir="rtl" with Arabic typography whenever the prompt is in Arabic.',
    );
  }
  if (opts.project) parts.push(`Current project context: ${opts.project.name}${opts.project.description ? ` — ${opts.project.description}` : ''}.`);
  if (opts.memory?.length) {
    parts.push(`Remembered facts:\n${opts.memory.map((m) => `- ${m.key}: ${truncate(m.content, 300)}`).join('\n')}`);
  }
  return parts.join('\n');
}
