import { useState } from 'react';
import { GitBranch, GitCommit, Github, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { absoluteTime, shortSha } from '@/lib/format';
import { useAppStore } from '@/store/app';
import { useCodeStore } from '@/store/code';
import { Badge, Button, EmptyState, TextInput } from '@/components/ui';

export function GitPanel() {
  const { t, locale } = useI18n();
  const git = useCodeStore((s) => s.git);
  const commits = useCodeStore((s) => s.commits);
  const loadGit = useCodeStore((s) => s.loadGit);
  const commitAll = useCodeStore((s) => s.commitAll);
  const pushGithub = useCodeStore((s) => s.pushGithub);
  const changes = useCodeStore((s) => s.changes);
  const toast = useAppStore((s) => s.toast);

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = changes.filter((c) => c.status === 'pending').length;

  const commit = async () => {
    if (!message.trim()) return;
    setBusy(true);
    const id = await commitAll(message.trim());
    setBusy(false);
    if (id) {
      toast({ kind: 'success', message: t('changes.committed', { sha: shortSha(id) }) });
      setMessage('');
    } else {
      toast({ kind: 'error', message: t('changes.commitBlocked') });
    }
  };

  const push = async () => {
    setBusy(true);
    const res = await pushGithub();
    setBusy(false);
    toast({ kind: res.ok ? 'success' : 'error', message: res.ok ? t('github.push') : t('github.notConfigured'), hint: res.detail });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2">
        <span className="flex items-center gap-1.5 text-[12px] text-text">
          <GitBranch size={13} className="text-accent" />
          <span className="font-mono">{git?.branch ?? 'main'}</span>
        </span>
        <Badge tone={git?.workingTree.clean ? 'success' : 'warning'}>
          {git?.workingTree.clean ? t('git.clean') : `${(git?.workingTree.added.length ?? 0) + (git?.workingTree.modified.length ?? 0) + (git?.workingTree.deleted.length ?? 0)}`}
        </Badge>
        <Button size="sm" variant="ghost" className="ms-auto" icon={<RefreshCw size={12} />} onClick={() => void loadGit()}>
          {t('common.refresh')}
        </Button>
      </div>

      <div className="shrink-0 border-b border-line p-2.5">
        <div className="flex items-center gap-1.5">
          <TextInput
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('changes.commitPlaceholder')}
            className="!py-1.5 !text-[12px]"
            onKeyDown={(e) => e.key === 'Enter' && void commit()}
          />
          <Button size="sm" variant="outline" icon={<GitCommit size={12} />} loading={busy} disabled={!message.trim() || pending > 0} onClick={() => void commit()}>
            {t('git.commit')}
          </Button>
        </div>
        {pending > 0 ? (
          <p className="mt-1.5 text-[10.5px] text-warning">{t('changes.commitBlocked')}</p>
        ) : null}
      </div>

      <div className="scroll-thin min-h-0 flex-1">
        {/* working tree */}
        <section className="border-b border-line px-2.5 py-2">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-dim">{t('git.status')}</p>
          {git?.workingTree.clean ? (
            <p className="text-[11.5px] text-dim">{t('git.clean')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {(git?.workingTree.added ?? []).map((p) => (
                <TreeLine key={`a-${p}`} path={p} kind={t('git.added')} tone="text-success" />
              ))}
              {(git?.workingTree.modified ?? []).map((p) => (
                <TreeLine key={`m-${p}`} path={p} kind={t('git.modified')} tone="text-warning" />
              ))}
              {(git?.workingTree.deleted ?? []).map((p) => (
                <TreeLine key={`d-${p}`} path={p} kind={t('git.deleted')} tone="text-danger" />
              ))}
            </ul>
          )}
        </section>

        {/* commits */}
        <section className="px-2.5 py-2">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-dim">{t('git.commits')}</p>
          {commits.length === 0 ? (
            <EmptyState icon={<GitCommit size={18} />} title={t('git.noCommits')} />
          ) : (
            <ul className="flex flex-col gap-1">
              {commits.map((c) => (
                <li key={c.id} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                  <div className="flex items-start gap-2">
                    <GitCommit size={12} className="mt-0.5 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-text">{c.message}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-dim">
                        <span>{shortSha(c.id)}</span>
                        <span>{c.author}</span>
                        <span className="text-success">+{c.stats.additions}</span>
                        <span className="text-danger">−{c.stats.deletions}</span>
                        <span>{c.stats.files}f</span>
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] text-dim" title={absoluteTime(c.createdAt, locale)}>
                      {shortSha(c.id, 4)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* GitHub */}
      <div className="shrink-0 border-t border-line p-2.5">
        <div className="flex items-center gap-2">
          <Github size={14} className="text-muted" />
          <span className="text-[12px] text-muted">{t('github.title')}</span>
          <Button size="sm" variant="outline" className="ms-auto" loading={busy} onClick={() => void push()}>
            {t('github.push')}
          </Button>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-dim">{t('github.notConfiguredHint')}</p>
      </div>
    </div>
  );
}

function TreeLine({ path, kind, tone }: { path: string; kind: string; tone: string }) {
  return (
    <li className="flex items-center gap-2 py-0.5">
      <span className={cn('w-16 shrink-0 text-[10.5px]', tone)}>{kind}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" dir="ltr" title={path}>
        {path}
      </span>
    </li>
  );
}
