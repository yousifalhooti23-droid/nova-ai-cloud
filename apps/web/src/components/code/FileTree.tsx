import { useMemo, useState } from 'react';
import type { TreeNode } from '@nova/shared';
import { buildTree } from '@nova/shared';
import { ChevronDown, ChevronRight, File as FileIcon, Folder, FolderOpen, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import type { FileSummary } from '@/store/code';
import { EmptyState, IconButton } from '@/components/ui';

export interface FileFlags {
  /** path → git-ish marker */
  added?: Set<string>;
  modified?: Set<string>;
  deleted?: Set<string>;
  /** paths with a pending agent proposal */
  proposed?: Set<string>;
  /** paths with unsaved editor changes */
  dirty?: Set<string>;
}

export function FileTree({
  files, activePath, onOpen, onDelete, flags, emptyLabel,
}: {
  files: FileSummary[];
  activePath: string | null;
  onOpen: (path: string) => void;
  onDelete?: (path: string) => void;
  flags?: FileFlags;
  emptyLabel: string;
}) {
  const tree = useMemo(() => buildTree(files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes }))), [files]);
  if (tree.length === 0) {
    return <EmptyState icon={<Folder size={20} />} title={emptyLabel} />;
  }
  return (
    <div className="py-1" dir="ltr">
      {tree.map((node) => (
        <Node
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          onOpen={onOpen}
          onDelete={onDelete}
          flags={flags}
        />
      ))}
    </div>
  );
}

function Node({ node, depth, activePath, onOpen, onDelete, flags }: { node: TreeNode; depth: number; activePath: string | null; onOpen: (p: string) => void; onDelete?: (p: string) => void; flags?: FileFlags }) {
  const [open, setOpen] = useState(depth < 1);
  const { t } = useI18n();

  if (node.type === 'dir') {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-1.5 py-[3px] text-[12px] text-muted transition-colors hover:bg-elevated/70 hover:text-text"
          style={{ paddingInlineStart: 6 + depth * 12 }}
        >
          {open ? <ChevronDown size={12} className="shrink-0 text-dim" /> : <ChevronRight size={12} className="shrink-0 text-dim" />}
          {open ? <FolderOpen size={13} className="shrink-0 text-accent/80" /> : <Folder size={13} className="shrink-0 text-dim" />}
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children
          ? node.children.map((child) => (
              <Node key={child.path} node={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} onDelete={onDelete} flags={flags} />
            ))
          : null}
      </div>
    );
  }

  const active = node.path === activePath;
  const marker = flags?.added?.has(node.path)
    ? { label: 'A', cls: 'text-success' }
    : flags?.modified?.has(node.path)
      ? { label: 'M', cls: 'text-warning' }
      : flags?.deleted?.has(node.path)
        ? { label: 'D', cls: 'text-danger' }
        : null;

  return (
    <div
      className={cn(
        'group flex w-full items-center gap-1 rounded px-1.5 py-[3px] text-[12px] transition-colors',
        active ? 'bg-accent/12 text-text' : 'text-muted hover:bg-elevated/70 hover:text-text',
      )}
      style={{ paddingInlineStart: 6 + depth * 12 + 12 }}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-start" onClick={() => onOpen(node.path)}>
        <FileIcon size={12} className={cn('shrink-0', active ? 'text-accent' : 'text-dim')} />
        <span className="truncate" title={node.path}>{node.name}</span>
      </button>
      {flags?.proposed?.has(node.path) ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title={t('changes.pending')} />
      ) : null}
      {flags?.dirty?.has(node.path) ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" title={t('code.unsaved')} />
      ) : null}
      {marker ? <span className={cn('shrink-0 font-mono text-[10px]', marker.cls)}>{marker.label}</span> : null}
      {onDelete ? (
        <span className="hidden shrink-0 group-hover:inline-flex">
          <IconButton label={t('code.deleteFile')} className="!px-1 !py-0.5" onClick={() => onDelete(node.path)}>
            <Trash2 size={11} />
          </IconButton>
        </span>
      ) : null}
      {node.sizeBytes !== undefined && !marker ? (
        <span className="hidden shrink-0 text-[10px] text-dim group-hover:hidden">{formatBytes(node.sizeBytes)}</span>
      ) : null}
    </div>
  );
}
