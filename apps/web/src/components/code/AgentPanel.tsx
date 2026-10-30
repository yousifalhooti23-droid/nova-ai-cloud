import { useEffect, useRef, useState } from 'react';
import type { FileChange, ServerEvent } from '@nova/shared';
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronRight, ListChecks, Play, RotateCcw, ShieldAlert,
  Square, Wrench, X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { prettyModelId, providerLabel } from '@/lib/format';
import { useAppStore } from '@/store/app';
import { useCodeStore, type AgentEventItem } from '@/store/code';
import { DiffStats, DiffView } from './DiffView';
import { Badge, Button, EmptyState, IconButton, Spinner, Switch, TextArea } from '@/components/ui';

const STATUS_KEY: Record<string, string> = {
  running: 'agent.status.running',
  awaiting_approval: 'agent.status.awaiting_approval',
  completed: 'agent.status.completed',
  failed: 'agent.status.failed',
  cancelled: 'agent.status.stopped',
};

export function AgentPanel() {
  const { t } = useI18n();
  const agent = useCodeStore((s) => s.agent);
  const setAgent = useCodeStore((s) => s.setAgent);
  const runAgent = useCodeStore((s) => s.runAgent);
  const stopAgent = useCodeStore((s) => s.stopAgent);
  const clearAgent = useCodeStore((s) => s.clearAgent);
  const changes = useCodeStore((s) => s.changes);
  const tasks = useCodeStore((s) => s.tasks);
  const sandbox = useAppStore((s) => s.sandbox);
  const toast = useAppStore((s) => s.toast);

  const feedRef = useRef<HTMLDivElement>(null);
  const pending = changes.filter((c) => c.status === 'pending');

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.events.length, agent.running]);

  const statusTone =
    agent.status === 'completed' ? 'success'
      : agent.status === 'awaiting_approval' ? 'warning'
      : agent.status === 'failed' || agent.status === 'cancelled' ? 'danger'
      : agent.status === 'running' ? 'info' : 'neutral';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* controls */}
      <div className="shrink-0 border-b border-line p-2.5">
        <TextArea
          rows={3}
          value={agent.prompt}
          disabled={agent.running}
          onChange={(e) => setAgent({ prompt: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (agent.prompt.trim() && !agent.running) void runAgent(agent.prompt);
            }
          }}
          placeholder={t('agent.promptPlaceholder')}
          className="!text-[12.5px]"
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1 text-[11px] text-dim">
            {t('agent.maxSteps')}
            <input
              type="number"
              min={1}
              max={30}
              value={agent.maxSteps}
              disabled={agent.running}
              onChange={(e) => setAgent({ maxSteps: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })}
              className="w-14 rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-[11px] text-text outline-none focus:border-accent/60"
            />
          </label>
          <Badge tone={agent.modelClass === 'coding' ? 'accent' : 'neutral'}>{t(`model.class.${agent.modelClass}` as never)}</Badge>
        </div>

        <div className="mt-2.5 flex flex-col gap-2">
          <Switch
            checked={agent.allowTerminal}
            onChange={(v) => setAgent({ allowTerminal: v })}
            disabled={agent.running}
            label={t('agent.allowTerminal')}
            hint={t('agent.allowTerminalHint')}
          />
          <Switch
            checked={agent.autoApply}
            onChange={(v) => setAgent({ autoApply: v })}
            disabled={agent.running}
            label={t('agent.autoApply')}
            hint={t('agent.autoApplyHint')}
          />
        </div>

        {agent.allowTerminal && sandbox && !sandbox.ready ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/8 p-2">
            <ShieldAlert size={13} className="mt-px shrink-0 text-warning" />
            <p className="text-[11px] leading-snug text-warning">{sandbox.detail}</p>
          </div>
        ) : null}

        <div className="mt-2.5 flex items-center gap-2">
          {agent.running ? (
            <Button variant="outline" className="!border-danger/40 !text-danger" icon={<Square size={12} />} onClick={stopAgent}>
              {t('agent.stop')}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<Play size={12} />}
              disabled={!agent.prompt.trim()}
              onClick={async () => {
                await runAgent(agent.prompt);
              }}
            >
              {t('agent.run')}
            </Button>
          )}
          {agent.events.length > 0 && !agent.running ? (
            <Button variant="ghost" size="sm" icon={<RotateCcw size={12} />} onClick={clearAgent}>
              {t('terminal.clear')}
            </Button>
          ) : null}
          {agent.running ? (
            <span className="ms-auto flex items-center gap-1.5 text-[11px] text-dim">
              <Spinner size={12} /> {t('agent.running')}
            </span>
          ) : null}
        </div>
      </div>

      {/* status strip */}
      {agent.status ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface/60 px-2.5 py-1.5">
          <Badge tone={statusTone as never}>{t((STATUS_KEY[agent.status] ?? 'agent.status.running') as never)}</Badge>
          {agent.step > 0 ? <span className="text-[11px] text-dim">{t('agent.step', { n: agent.step })}</span> : null}
          {agent.modelId ? (
            <span className="truncate text-[11px] text-dim" title={agent.modelId}>
              {prettyModelId(agent.modelId)}
              {agent.provider ? ` · ${providerLabel(agent.provider)}` : ''}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* feed */}
      <div ref={feedRef} className="scroll-thin min-h-0 flex-1">
        {agent.events.length === 0 ? (
          <EmptyState
            icon={<Bot size={20} />}
            title={t('agent.empty')}
            hint={t('changes.requiresApproval')}
          />
        ) : (
          <ol className="flex flex-col gap-1 p-2">
            {agent.events.map((item) => (
              <FeedItem
                key={item.seq}
                item={item}
                onToast={(message, kind) => toast({ kind, message })}
                pending={pending}
              />
            ))}
          </ol>
        )}
      </div>

      {/* tasks summary */}
      {tasks.length > 0 ? (
        <div className="shrink-0 border-t border-line bg-surface/60 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-dim">
            <ListChecks size={12} />
            <span>{t('tasks.title')}</span>
            <span className="ms-auto">
              {tasks.filter((x) => x.status === 'done').length}/{tasks.length}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FeedItem({ item, onToast, pending }: { item: AgentEventItem; onToast: (m: string, k: 'info' | 'success' | 'error') => void; pending: FileChange[] }) {
  const { t } = useI18n();
  const evt: ServerEvent = item.event;

  switch (evt.type) {
    case 'agent.start':
      return (
        <Row icon={<Bot size={12} className="text-accent" />} tone="accent">
          <span className="text-[11.5px]">
            {t('agent.run')} · <span className="text-muted">{prettyModelId(evt.modelId)}</span>
            <span className="text-dim"> ({evt.maxSteps} max)</span>
          </span>
        </Row>
      );

    case 'agent.thought':
      return (
        <Collapsible icon={<ChevronRight size={11} />} label={t('agent.thought')} tone="neutral">
          <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{evt.text}</p>
        </Collapsible>
      );

    case 'agent.tool.start':
      return (
        <Collapsible
          icon={<Wrench size={11} className="text-info" />}
          label={`${evt.name}`}
          tone="info"
          defaultOpen={false}
        >
          <pre className="scroll-thin max-h-40 overflow-auto font-mono text-[11px] leading-relaxed text-muted" dir="ltr">
            {JSON.stringify(evt.args ?? {}, null, 2)}
          </pre>
        </Collapsible>
      );

    case 'agent.tool.result':
      return (
        <Collapsible
          icon={evt.ok ? <Check size={11} className="text-success" /> : <X size={11} className="text-danger" />}
          label={`${evt.name} · ${evt.ok ? 'ok' : 'error'}${evt.truncated ? ' · …' : ''}`}
          tone={evt.ok ? 'success' : 'danger'}
        >
          <pre className="scroll-thin max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted" dir="ltr">
            {evt.output || '(empty)'}
          </pre>
        </Collapsible>
      );

    case 'agent.change.proposed':
      return (
        <ChangeProposal
          change={evt.change}
          before={evt.change.before ?? ''}
          after={evt.change.after ?? ''}
          additions={evt.additions}
          deletions={evt.deletions}
          isPending={pending.some((p) => p.id === evt.change.id)}
          onToast={onToast}
        />
      );

    case 'agent.tasks.updated':
      return (
        <Row icon={<ListChecks size={12} className="text-info" />} tone="neutral">
          <span className="text-[11.5px] text-muted">
            {t('tasks.title')}: {evt.tasks.length} · {evt.tasks.filter((x) => x.status === 'done').length} {t('tasks.done')}
          </span>
        </Row>
      );

    case 'agent.await.approval':
      return (
        <Row icon={<AlertTriangle size={12} className="text-warning" />} tone="warning">
          <span className="text-[11.5px] text-warning">
            {evt.reason} ({evt.changeIds.length})
          </span>
        </Row>
      );

    case 'agent.done':
      return (
        <Collapsible icon={<Bot size={12} className="text-accent" />} label={`${t('agent.summary')} · ${t((STATUS_KEY[evt.run.status] ?? 'agent.status.completed') as never)}`} tone="accent" defaultOpen>
          <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{evt.summary || '—'}</p>
          {evt.run.error ? <p className="mt-1 text-[11.5px] text-danger">{evt.run.error}</p> : null}
          <p className="mt-1 text-[10.5px] text-dim">
            {evt.run.steps} steps · {evt.run.modelId}
          </p>
        </Collapsible>
      );

    case 'error':
      return (
        <Row icon={<AlertTriangle size={12} className="text-danger" />} tone="danger">
          <span className="text-[11.5px] text-danger">{evt.message}</span>
        </Row>
      );

    case 'agent.status':
      return null; // reflected in the status strip

    default:
      return null;
  }
}

const toneRing: Record<string, string> = {
  accent: 'border-accent/25 bg-accent/6',
  info: 'border-info/25 bg-info/6',
  success: 'border-success/25 bg-success/6',
  warning: 'border-warning/25 bg-warning/6',
  danger: 'border-danger/25 bg-danger/6',
  neutral: 'border-line bg-surface',
};

function Row({ icon, tone = 'neutral', children }: { icon?: React.ReactNode; tone?: string; children: React.ReactNode }) {
  return (
    <li className={cn('flex items-start gap-2 rounded-lg border px-2 py-1.5', toneRing[tone] ?? toneRing.neutral)}>
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

function Collapsible({ icon, label, children, tone = 'neutral', defaultOpen = false }: { icon?: React.ReactNode; label: string; children: React.ReactNode; tone?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className={cn('overflow-hidden rounded-lg border', toneRing[tone] ?? toneRing.neutral)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-start"
      >
        {open ? <ChevronDown size={11} className="shrink-0 text-dim" /> : <ChevronRight size={11} className="shrink-0 text-dim" />}
        {icon}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text">{label}</span>
      </button>
      {open ? <div className="border-t border-line/70 px-2 py-1.5">{children}</div> : null}
    </li>
  );
}

function ChangeProposal({ change, before, after, additions, deletions, isPending, onToast }: {
  change: FileChange; before: string; after: string; additions: number; deletions: number; isPending: boolean;
  onToast: (m: string, k: 'info' | 'success' | 'error') => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const decideChange = useCodeStore((s) => s.decideChange);
  const [busy, setBusy] = useState(false);

  const act = async (action: 'apply' | 'reject') => {
    setBusy(true);
    await decideChange(change.id, action);
    setBusy(false);
    onToast(action === 'apply' ? `${change.path}` : `${change.path}`, action === 'apply' ? 'success' : 'info');
  };

  return (
    <li className="overflow-hidden rounded-lg border border-accent/25 bg-accent/5">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1.5 text-start">
          {open ? <ChevronDown size={11} className="shrink-0 text-dim" /> : <ChevronRight size={11} className="shrink-0 text-dim" />}
          <Badge tone={change.kind === 'create' ? 'success' : change.kind === 'delete' ? 'danger' : 'warning'}>{change.kind}</Badge>
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text" dir="ltr" title={change.path}>
            {change.path}
          </span>
        </button>
        <span className="shrink-0 font-mono text-[10.5px]">
          <span className="text-success">+{additions}</span> <span className="text-danger">−{deletions}</span>
        </span>
      </div>
      {change.reason ? (
        <p className="border-t border-line/60 px-2 py-1 text-[11px] leading-snug text-dim">{change.reason}</p>
      ) : null}
      {open ? (
        <div className="max-h-64 overflow-hidden border-t border-line/60">
          <DiffView before={before} after={after} mode="unified" className="max-h-64" />
        </div>
      ) : null}
      {isPending ? (
        <div className="flex items-center gap-1.5 border-t border-line/60 px-2 py-1.5">
          <Button size="sm" variant="success" icon={<Check size={11} />} loading={busy} onClick={() => void act('apply')}>
            {t('changes.approve')}
          </Button>
          <Button size="sm" variant="ghost" icon={<X size={11} />} loading={busy} onClick={() => void act('reject')}>
            {t('changes.reject')}
          </Button>
          <span className="ms-auto text-[10.5px] text-dim">{t('changes.pending')}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 border-t border-line/60 px-2 py-1.5">
          <Badge tone="neutral">{change.status}</Badge>
        </div>
      )}
    </li>
  );
}

export { DiffStats };
