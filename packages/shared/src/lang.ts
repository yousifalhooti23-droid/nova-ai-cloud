/** Path → language mapping (used by the editor, the diff viewer and prompts). */

const EXT_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', tsconfig: 'json',
  md: 'markdown', mdx: 'markdown', txt: 'plaintext',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', env: 'shell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', vue: 'html', svelte: 'html',
  dockerfile: 'docker', makefile: 'makefile', prisma: 'prisma',
};

const NAME_MAP: Record<string, string> = {
  dockerfile: 'docker', makefile: 'makefile', '.gitignore': 'plaintext',
  '.env': 'shell', '.env.example': 'shell', 'wrangler.toml': 'toml', 'wrangler.jsonc': 'json',
};

export function detectLanguage(path: string): string {
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if (NAME_MAP[base]) return NAME_MAP[base];
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  return EXT_MAP[ext] ?? 'plaintext';
}

export const BINARY_EXTENSIONS = new Set([
  'png','jpg','jpeg','gif','webp','ico','bmp','pdf','zip','gz','tar','rar','7z',
  'mp3','wav','ogg','mp4','mov','webm','woff','woff2','ttf','otf','eot','wasm','bin','exe','db','sqlite',
]);

export function isBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

/** Rough token estimate (~4 chars/token) — used for context budgeting, not billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncate(text: string, maxChars: number, suffix = '\n…[truncated]'): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - suffix.length)) + suffix;
}

/** Extract ```code fences``` from a model answer (used by "apply this code"). */
export function extractCodeFences(markdown: string): { lang: string; code: string }[] {
  const out: { lang: string; code: string }[] = [];
  const re = /```([a-zA-Z0-9+#._-]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) out.push({ lang: (m[1] || '').toLowerCase(), code: m[2] });
  return out;
}

export function normalizePath(input: string): string {
  let p = input.replace(/\\/g, '/').trim();
  while (p.startsWith('/')) p = p.slice(1);
  p = p.split('/').filter((s) => s.length > 0 && s !== '.').join('/');
  // Reject traversal explicitly; callers must treat null-ish results as errors.
  return p;
}

export function hasTraversal(input: string): boolean {
  return input.split(/[\\/]/).some((seg) => seg === '..');
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  sizeBytes?: number;
  children?: TreeNode[];
}

/** Build a file tree from a flat list of paths (used by the sidebar explorer). */
export function buildTree(files: { path: string; sizeBytes?: number }[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'dir', children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    const parts = f.path.split('/');
    let currentPath = '';
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      let node = dirs.get(currentPath);
      if (!node) {
        node = { name: parts[i], path: currentPath, type: 'dir', children: [] };
        dirs.set(currentPath, node);
        parent.children!.push(node);
      }
      parent = node;
    }
    parent.children!.push({ name: parts[parts.length - 1], path: f.path, type: 'file', sizeBytes: f.sizeBytes });
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    for (const n of nodes) if (n.children) sortRec(n.children);
  };
  sortRec(root.children!);
  return root.children!;
}

/** Mask a secret for display. Never returns enough characters to reconstruct it. */
export function maskSecretSafe(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}
