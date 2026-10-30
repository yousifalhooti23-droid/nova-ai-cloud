import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, GitCommit, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { relativeTime, shortSha } from '@/lib/format';
import { useAppStore } from '@/store/app';
import { useCodeStore } from '@/store/code';
import { DiffView } from './DiffView';
import { Badge, Button, EmptyState, TextInput } from '@/components/ui';

export function ChangesPanel() {
  const { t, locale } = useI18n();
  const changes = useCodeStore((s) => s.changes);
  const decideChange = useCodeStore((s) => s.decideChange);
  const decideAll = useCodeStore((s) => s.decideAll);
  const commitAll = useCodeStore((s) => s.commitAll);
  const openFile = useCodeStore((s) => s.openFile);
  const toast = useAppStore((s) => s.toast);

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'apply' | 'reject' | 'commit' | null>(null);

  const pending = useMemo(() => changes.filter((c) => c.status === 'pending'), [changes]);
  const resolved = useMemo(() => changes.filter((c) => c.status !== 'pending'), [changes]);

  const applyAll = async (action: 'apply' | 'reject') => {
    setBusy(action);
    const n = await decideAll(action, message.trim() || undefined);
    setBusy(null);
    if (n > 0) {
      toast({ kind: action === 'apply' ? 'success' : 'info', message: `${n} ${action === 'apply' ? t('changes.applied') : t('changes.rejected')}` });
      setMessage('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line p-2.5">
        <div className="flex items-center gap-2">
          <Badge tone={pending.length ? 'warning' : 'neutral'}>
            {pending.length ? `${pending.length} ${t('changes.pending')}` : t('changes.noPending')}
          </Badge>
          <div className="ms-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="success"
              icon={<Check size={11} />}
              disabled={pending.length === 0}
              loading={busy === 'apply'}
              onClick={() => void applyAll('apply')}
            >
              {t('changes.approveAll')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<X size={11} />}
              disabled={pending.length === 0}
              loading={busy === 'reject'}
              onClick={() => void applyAll('reject')}
            >
              {t('changes.rejectAll')}
            </Button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <TextInput
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('changes.commitPlaceholder')}
            className="!py-1.5 !text-[12px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && message.trim()) void doCommit();
            }}
          />
          <Button
            size="sm"
            variant="outline"
            icon={<GitCommit size={12} />}
            loading={busy === 'commit'}
            onClick={() => void doCommit()}
            title={pending.length ? t('changes.commitBlocked') : t('changes.commit')}
          >
            {t('changes.commit')}
          </Button>
        </div>
        {pending.length > 0 ? (
          <p className="mt-1.5 text-[10.5px] leading-snug text-warning">{t('changes.commitBlocked')}</p>
        ) : null}
      </div>

      <div className="scroll-thin min-h-0 flex-1">
        {changes.length === 0 ? (
          <EmptyState icon={<Check size={20} />} title={t('changes.empty')} hint={t('changes.requiresApproval')} />
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {pending.map((c) => (
              <ChangeRow
                key={c.id}
                id={c.id}
                path={c.path}
                kind={c.kind}
                status={c.status}
                before={c.before ?? ''}
                after={c.after ?? ''}
                additions={c.additions}
                deletions={c.deletions}
                reason={c.reason}
                at={c.createdAt}
                open={open[c.id] ?? true}
                onToggle={() => setOpen((s) => ({ ...s, [c.id]: !(s[c.id] ?? true) }))}
                onOpenFile={() => void openFile(c.path)}
                onDecide={async (action) => {
                  setBusy(action === 'apply' ? 'apply' : 'reject');
                  await decideChange(c.id, action);
                  setBusy(null);
                }}
                busy={busy !== null}
                locale={locale}
              />
            ))}
            {resolved.length > 0 ? (
              <div className="mt-2 border-t border-line pt-2">
                <p className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-dim">
                  {t('common.of')} {changes.length}
                </p>
                {resolved.map((c) => (
                  <ChangeRow
                    key={c.id}
                    id={c.id}
                    path={c.path}
                    kind={c.kind}
                    status={c.status}
                    before={c.before ?? ''}
                    after={c.after ?? ''}
                    additions={c.additions}
                    deletions={c.deletions}
                    reason={c.reason}
                    at={c.createdAt}
                    open={open[c.id] ?? false}
                    onToggle={() => setOpen((s) => ({ ...s, [c.id]: !(s[c.id] ?? false) }))}
                    onOpenFile={() => void openFile(c.path)}
                    busy={false}
                    locale={locale}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {pending.length > 0 ? (
        <div className="shrink-0 border-t border-line bg-surface/60 px-2.5 py-1.5 text-[10.5px] text-dim">
          {t('changes.requiresApproval')}
        </div>
      ) : null}
    </div>
  );

  async function doCommit() {
    if (!message.trim()) return;
    setBusy('commit');
    const id = await commitAll(message.trim());
    setBusy(null);
    if (id) {
      toast({ kind: 'success', message: t('changes.committed', { sha: shortSha(id) }) });
      setMessage('');
    } else {
      toast({ kind: 'error', message: t('changes.commitBlocked') });
    }
  }
}

function ChangeRow({ id, path, kind, status, before, after, additions, deletions, reason, at, open, onToggle, onDecide, onOpenFile, busy, locale }: {
  id: string; path: string; kind: string; status: string; before: string; after: string;
  additions: number; deletions: number; reason?: string; at: string; open: boolean;
  onToggle: () => void; onDecide?: (a: 'apply' | 'reject') => void; onOpenFile: () => void; busy: boolean; locale: 'ar' | 'en';
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border',
        status === 'pending' ? 'border-accent/25 bg-accent/5' : 'border-line bg-surface',
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-start">
          {open ? <ChevronDown size={11} className="shrink-0 text-dim" /> : <ChevronRight size={11} className="shrink-0 text-dim" />}
          <Badge tone={kind === 'create' ? 'success' : kind === 'delete' ? 'danger' : 'warning'}>{kind}</Badge>
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" dir="ltr" title={path}>
            {path}
          </span>
        </button>
        <span className="shrink-0 font-mono text-[10.5px]">
          <span className="text-success">+{additions}</span> <span className="text-danger">−{deletions}</span>
        </span>
      </div>

      {open ? (
        <>
          {reason ? <p className="border-t border-line/60 px-2 py-1 text-[11px] leading-snug text-dim">{reason}</p> : null}
          <DiffView before={before} after={after} className="max-h-72 border-t border-line/60" />
        </>
      ) : null}

      <div className="flex items-center gap-1.5 border-t border-line/60 px-2 py-1.5">
        {status === 'pending' && onDecide ? (
          <>
            <Button size="sm" variant="success" icon={<Check size={11} />} disabled={busy} onClick={() => onDecide('apply')}>
              {t('changes.approve')}
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={11} />} disabled={busy} onClick={() => onDecide('reject')}>
              {t('changes.reject')}
            </Button>
          </>
        ) : (
          <Badge tone={status === 'applied' ? 'success' : 'neutral'}>{t(`changes.${status}` as never)}</Badge>
        )}
        <button type="button" onClick={onOpenFile} className="ms-auto text-[10.5px] text-dim transition-colors hover:text-text">
          {t('code.editor')}
        </button>
        <span className="text-[10.5px] text-dim">{relativeTime(at, locale)}</span>
      </div>
    </div>
  );
}
