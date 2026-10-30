import { useMemo } from 'react';
import { diff, type DiffLine, type DiffResult } from '@nova/shared';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';

export type DiffMode = 'unified' | 'side';

/**
 * Diff renderer built on the shared Myers diff, so what the user sees is exactly
 * what the worker computed for the approval flow (same algorithm, same lines).
 */
export function DiffView({
  before, after, mode = 'unified', className, maxLines,
}: { before: string; after: string; mode?: DiffMode; className?: string; maxLines?: number }) {
  const { t } = useI18n();
  const result: DiffResult = useMemo(() => diff(before ?? '', after ?? ''), [before, after]);

  if (!result.changed) {
    return (
      <div className={cn('px-3 py-6 text-center text-[12px] text-dim', className)}>{t('diff.noChanges')}</div>
    );
  }

  const lines = maxLines ? result.lines.slice(0, maxLines) : result.lines;

  return mode === 'side' ? (
    <SideBySide lines={lines} truncated={Boolean(maxLines) && result.lines.length > lines.length} className={className} />
  ) : (
    <Unified lines={lines} truncated={Boolean(maxLines) && result.lines.length > lines.length} className={className} />
  );
}

export function DiffStats({ before, after }: { before: string; after: string }) {
  const { t } = useI18n();
  const r = useMemo(() => diff(before ?? '', after ?? ''), [before, after]);
  if (!r.changed) return <span className="text-[11px] text-dim">{t('diff.noChanges')}</span>;
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px]">
      <span className="text-success">{t('diff.added', { n: r.additions })}</span>
      <span className="text-danger">{t('diff.removed', { n: r.deletions })}</span>
    </span>
  );
}

function Unified({ lines, truncated, className }: { lines: DiffLine[]; truncated: boolean; className?: string }) {
  return (
    <div className={cn('scroll-thin overflow-auto', className)} dir="ltr">
      <div className="min-w-full font-mono text-[12.5px] leading-[1.6]">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              'diff-line px-2',
              l.op === 'insert' && 'diff-add',
              l.op === 'delete' && 'diff-del',
            )}
          >
            <span className="diff-gutter">{l.oldNo ?? ''}</span>
            <span className="diff-gutter">{l.newNo ?? ''}</span>
            <span className={cn('w-3 shrink-0 select-none', l.op === 'insert' ? 'text-success' : l.op === 'delete' ? 'text-danger' : 'text-dim')}>
              {l.op === 'insert' ? '+' : l.op === 'delete' ? '−' : ' '}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre">{l.text || ' '}</span>
          </div>
        ))}
        {truncated ? <div className="px-3 py-1.5 text-[11px] text-dim">…</div> : null}
      </div>
    </div>
  );
}

interface Cell {
  no: number | null;
  text: string;
  kind: 'same' | 'add' | 'del' | 'empty';
}

function pairLines(lines: DiffLine[]): { left: Cell; right: Cell }[] {
  const rows: { left: Cell; right: Cell }[] = [];
  const pendingDel: DiffLine[] = [];
  const flush = (adds: DiffLine[]) => {
    const n = Math.max(pendingDel.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = pendingDel[i];
      const a = adds[i];
      rows.push({
        left: d ? { no: d.oldNo, text: d.text, kind: 'del' } : { no: null, text: '', kind: 'empty' },
        right: a ? { no: a.newNo, text: a.text, kind: 'add' } : { no: null, text: '', kind: 'empty' },
      });
    }
    pendingDel.length = 0;
  };
  let addBuffer: DiffLine[] = [];
  for (const l of lines) {
    if (l.op === 'equal') {
      flush(addBuffer);
      addBuffer = [];
      rows.push({
        left: { no: l.oldNo, text: l.text, kind: 'same' },
        right: { no: l.newNo, text: l.text, kind: 'same' },
      });
    } else if (l.op === 'delete') {
      if (addBuffer.length) { flush(addBuffer); addBuffer = []; }
      pendingDel.push(l);
    } else {
      addBuffer.push(l);
    }
  }
  flush(addBuffer);
  return rows;
}

function SideBySide({ lines, truncated, className }: { lines: DiffLine[]; truncated: boolean; className?: string }) {
  const { t } = useI18n();
  const rows = useMemo(() => pairLines(lines), [lines]);
  const bg: Record<Cell['kind'], string> = {
    same: '',
    add: 'bg-success/10',
    del: 'bg-danger/10',
    empty: 'bg-line/25',
  };
  return (
    <div className={cn('scroll-thin overflow-auto', className)} dir="ltr">
      <div className="grid min-w-full grid-cols-2 font-mono text-[12.5px] leading-[1.6]">
        <div className="border-e border-line px-2 py-1 text-[10.5px] uppercase tracking-wide text-dim">{t('diff.before')}</div>
        <div className="px-2 py-1 text-[10.5px] uppercase tracking-wide text-dim">{t('diff.after')}</div>
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <div className={cn('diff-line border-e border-line px-2', bg[r.left.kind])}>
              <span className="diff-gutter">{r.left.no ?? ''}</span>
              <span className="min-w-0 flex-1 whitespace-pre">{r.left.text || ' '}</span>
            </div>
            <div className={cn('diff-line px-2', bg[r.right.kind])}>
              <span className="diff-gutter">{r.right.no ?? ''}</span>
              <span className="min-w-0 flex-1 whitespace-pre">{r.right.text || ' '}</span>
            </div>
          </div>
        ))}
      </div>
      {truncated ? <div className="px-3 py-1.5 text-[11px] text-dim">…</div> : null}
    </div>
  );
}
