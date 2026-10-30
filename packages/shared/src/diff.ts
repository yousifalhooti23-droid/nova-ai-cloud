/**
 * Line-level diff used by the Diff viewer, the change-approval flow and git
 * commit stats. Myers' O(ND) algorithm — no dependencies, deterministic,
 * works identically in the browser and in workerd.
 */

export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  op: DiffOp;
  /** Line number in the old file (1-based) or null for insertions. */
  oldNo: number | null;
  /** Line number in the new file (1-based) or null for deletions. */
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffResult {
  lines: DiffLine[];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  changed: boolean;
}

/**
 * Split like git does: a single trailing newline terminates the last line
 * instead of creating a phantom empty one (so "a\n" counts as 1 line).
 */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Myers shortest edit script. Falls back to a coarse whole-file replacement
 * when the input is so large that the O(ND) search would blow the CPU budget.
 */
export function diffLines(oldText: string, newText: string, maxElements = 4_000_000): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  if (a.length * b.length > maxElements) {
    // Too big for exact Myers: emit delete-all + insert-all (still correct, less pretty).
    const coarse: DiffLine[] = [];
    a.forEach((text, i) => coarse.push({ op: 'delete', oldNo: i + 1, newNo: null, text }));
    b.forEach((text, i) => coarse.push({ op: 'insert', oldNo: null, newNo: i + 1, text }));
    return coarse;
  }

  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  v[max + 1] = 0;

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const idx = max + k;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) x = v[idx + 1];
      else x = v[idx - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[idx] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  // Backtrack to recover the edit script.
  const ops: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vPrev[max + k - 1] < vPrev[max + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vPrev[max + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ op: 'equal', oldNo: x + 1, newNo: y + 1, text: a[x] });
    }
    if (d > 0) {
      if (x === prevX) {
        y--;
        ops.push({ op: 'insert', oldNo: null, newNo: y + 1, text: b[y] });
      } else {
        x--;
        ops.push({ op: 'delete', oldNo: x + 1, newNo: null, text: a[x] });
      }
    }
  }
  ops.reverse();
  return ops;
}

/** Group a flat diff into unified-diff style hunks with surrounding context. */
export function toHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const changedIdx = lines.map((l, i) => (l.op === 'equal' ? -1 : i)).filter((i) => i >= 0);
  if (changedIdx.length === 0) return hunks;

  const groups: number[][] = [];
  let current: number[] = [changedIdx[0]];
  for (let i = 1; i < changedIdx.length; i++) {
    if (changedIdx[i] - changedIdx[i - 1] <= context * 2 + 1) current.push(changedIdx[i]);
    else {
      groups.push(current);
      current = [changedIdx[i]];
    }
  }
  groups.push(current);

  for (const g of groups) {
    const start = Math.max(0, g[0] - context);
    const end = Math.min(lines.length - 1, g[g.length - 1] + context);
    const slice = lines.slice(start, end + 1);
    const oldStart = slice.find((l) => l.oldNo !== null)?.oldNo ?? 0;
    const newStart = slice.find((l) => l.newNo !== null)?.newNo ?? 0;
    hunks.push({
      oldStart,
      newStart,
      oldLines: slice.filter((l) => l.op !== 'insert').length,
      newLines: slice.filter((l) => l.op !== 'delete').length,
      lines: slice,
    });
  }
  return hunks;
}

export function diff(oldText: string, newText: string, context = 3): DiffResult {
  const lines = diffLines(oldText, newText);
  const additions = lines.filter((l) => l.op === 'insert').length;
  const deletions = lines.filter((l) => l.op === 'delete').length;
  return { lines, hunks: toHunks(lines, context), additions, deletions, changed: additions + deletions > 0 };
}

/** Render a git-style unified diff. Handy for the terminal panel and commits. */
export function toUnifiedDiff(oldText: string, newText: string, path: string, context = 3): string {
  const d = diff(oldText, newText, context);
  if (!d.changed) return '';
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of d.hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) {
      out.push(l.op === 'insert' ? `+${l.text}` : l.op === 'delete' ? `-${l.text}` : ` ${l.text}`);
    }
  }
  return out.join('\n');
}

/**
 * Apply a search/replace edit exactly like the agent's `edit_file` tool.
 * `replaceAll = false` requires the search text to be unique — ambiguity is an
 * error, never a silent guess.
 */
export function applyEdit(
  source: string,
  search: string,
  replace: string,
  opts: { replaceAll?: boolean } = {},
): { ok: true; text: string; replacements: number } | { ok: false; error: string; occurrences: number } {
  if (search === '') return { ok: false, error: 'search text must not be empty', occurrences: 0 };
  const occurrences = countOccurrences(source, search);
  if (occurrences === 0) return { ok: false, error: 'search text not found in file', occurrences };
  if (occurrences > 1 && !opts.replaceAll) {
    return {
      ok: false,
      error: `search text is ambiguous (${occurrences} occurrences). Add more surrounding lines or set replaceAll.`,
      occurrences,
    };
  }
  const text = opts.replaceAll ? source.split(search).join(replace) : source.replace(search, replace);
  return { ok: true, text, replacements: opts.replaceAll ? occurrences : 1 };
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Cheap similarity ratio (0..1) used to rank "did you mean" suggestions. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const sa = new Set(a.split(/\W+/).filter(Boolean));
  const sb = new Set(b.split(/\W+/).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter || 1);
}
