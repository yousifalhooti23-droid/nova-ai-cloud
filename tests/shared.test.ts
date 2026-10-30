import { describe, expect, it } from 'vitest';
import {
  applyEdit, buildTree, createSseParser, detectLanguage, diff, encodeEvent, estimateTokens,
  extractCodeFences, hasTraversal, isBinaryPath, normalizePath, toUnifiedDiff, type ServerEvent,
} from '@nova/shared';

describe('diff engine (Myers)', () => {
  it('reports no change for identical text', () => {
    const d = diff('a\nb\nc', 'a\nb\nc');
    expect(d.changed).toBe(false);
    expect(d.additions).toBe(0);
    expect(d.deletions).toBe(0);
    expect(d.hunks).toHaveLength(0);
  });

  it('detects an insertion in the middle', () => {
    const d = diff('a\nb\nc', 'a\nX\nb\nc');
    expect(d.additions).toBe(1);
    expect(d.deletions).toBe(0);
    expect(d.lines.filter((l) => l.op === 'insert').map((l) => l.text)).toEqual(['X']);
  });

  it('detects a deletion and keeps line numbers', () => {
    const d = diff('1\n2\n3\n4', '1\n3\n4');
    expect(d.deletions).toBe(1);
    const deleted = d.lines.find((l) => l.op === 'delete');
    expect(deleted?.text).toBe('2');
    expect(deleted?.oldNo).toBe(2);
  });

  it('produces a git-style unified diff', () => {
    const patch = toUnifiedDiff('a\nb', 'a\nB', 'f.ts');
    expect(patch).toContain('--- a/f.ts');
    expect(patch).toContain('+++ b/f.ts');
    expect(patch).toContain('-b');
    expect(patch).toContain('+B');
    expect(patch).toMatch(/@@ -1,2 \+1,2 @@/);
  });

  it('groups distant edits into separate hunks', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line${i}`);
    const next = [...lines];
    next[2] = 'CHANGED-TOP';
    next[37] = 'CHANGED-BOTTOM';
    const d = diff(lines.join('\n'), next.join('\n'));
    expect(d.hunks.length).toBe(2);
    expect(d.additions).toBe(2);
    expect(d.deletions).toBe(2);
  });

  it('handles empty files in both directions', () => {
    expect(diff('', 'hello').additions).toBe(1);
    expect(diff('hello', '').deletions).toBe(1);
    expect(diff('', '').changed).toBe(false);
  });
});

describe('applyEdit (the edit_file primitive)', () => {
  const src = 'const a = 1;\nconst b = 2;\nconst a2 = 1;\n';

  it('replaces a unique snippet', () => {
    const res = applyEdit(src, 'const b = 2;', 'const b = 3;');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toContain('const b = 3;');
  });

  it('refuses an ambiguous match instead of guessing', () => {
    const res = applyEdit(src, 'const a', 'X');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.occurrences).toBeGreaterThan(1);
  });

  it('replaces every occurrence when asked', () => {
    const res = applyEdit(src, 'const a', 'X', { replaceAll: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.replacements).toBe(2);
  });

  it('fails when the snippet is absent', () => {
    const res = applyEdit(src, 'nope', 'x');
    expect(res.ok).toBe(false);
  });
});

describe('path + language helpers', () => {
  it('normalizes and rejects traversal', () => {
    expect(normalizePath('/src//a/./b.ts')).toBe('src/a/b.ts');
    expect(hasTraversal('../../etc/passwd')).toBe(true);
    expect(hasTraversal('src/ok.ts')).toBe(false);
  });

  it('maps extensions to languages', () => {
    expect(detectLanguage('src/a.tsx')).toBe('typescript');
    expect(detectLanguage('Dockerfile')).toBe('docker');
    expect(detectLanguage('notes.unknownext')).toBe('plaintext');
  });

  it('flags binary paths', () => {
    expect(isBinaryPath('logo.png')).toBe(true);
    expect(isBinaryPath('app.ts')).toBe(false);
  });

  it('builds a sorted tree with directories first', () => {
    const tree = buildTree([
      { path: 'src/b.ts', sizeBytes: 10 },
      { path: 'src/a.ts', sizeBytes: 20 },
      { path: 'README.md', sizeBytes: 5 },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['src', 'README.md']);
    expect(tree[0].children?.map((n) => n.name)).toEqual(['a.ts', 'b.ts']);
  });

  it('estimates tokens and extracts code fences', () => {
    expect(estimateTokens('abcd')).toBe(1);
    const fences = extractCodeFences('text ```ts\nconst a=1;\n``` more');
    expect(fences[0]).toEqual({ lang: 'ts', code: 'const a=1;\n' });
  });
});

describe('SSE protocol', () => {
  it('round-trips events through the parser', () => {
    const received: ServerEvent[] = [];
    const parser = createSseParser((e) => received.push(e));
    const events: ServerEvent[] = [
      { type: 'message.start', messageId: 'm1', modelId: 'workers-ai:qwen3.8-27b', provider: 'workers-ai' },
      { type: 'text.delta', messageId: 'm1', text: 'مرحبا' },
      { type: 'message.done', messageId: 'm1', tokensIn: 3, tokensOut: 1, finishReason: 'stop' },
    ];
    const raw = events.map(encodeEvent).join('');
    // Feed in awkward chunks to prove the buffer logic works.
    for (let i = 0; i < raw.length; i += 7) parser.push(raw.slice(i, i + 7));
    expect(received).toEqual(events);
  });

  it('ignores heartbeats and malformed frames', () => {
    const received: ServerEvent[] = [];
    const errors: unknown[] = [];
    const parser = createSseParser((e) => received.push(e), (e) => errors.push(e));
    parser.push(': ping\n\nevent: text.delta\ndata: {bad json}\n\nevent: x\ndata: {"type":"ping"}\n\n');
    expect(received).toEqual([{ type: 'ping' }]);
    expect(errors).toHaveLength(1);
  });
});
