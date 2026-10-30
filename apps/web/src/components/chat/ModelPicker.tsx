import { useMemo, useState } from 'react';
import type { ModelClass, ModelInfo, ProviderInfo } from '@nova/shared';
import { ChevronDown, Cpu, Search, Sparkles, Wrench } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatNumber, prettyModelId, providerLabel } from '@/lib/format';
import { useAppStore } from '@/store/app';
import { Badge, Dropdown, TextInput, type BadgeTone } from '@/components/ui';

const CLASSES: ModelClass[] = ['chat', 'reasoning', 'coding', 'long-context'];

/**
 * Stable empty references for selectors.
 * Returning a fresh `[]` from a zustand selector makes `useSyncExternalStore`
 * see a changed snapshot on every render, which loops forever.
 */
const NO_MODELS: ModelInfo[] = [];
const NO_PROVIDERS: ProviderInfo[] = [];

export function ModelPicker({
  value,
  onChange,
  modelClass,
  onClassChange,
  className,
  showClass = true,
  compact = false,
}: {
  value: string | null;
  onChange: (modelId: string | null) => void;
  modelClass?: ModelClass;
  onClassChange?: (c: ModelClass) => void;
  className?: string;
  showClass?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const models = useAppStore((s) => s.models?.models ?? NO_MODELS);
  const healthProviders = useAppStore((s) => s.health?.providers ?? NO_PROVIDERS);
  const catalogProviders = useAppStore((s) => s.models?.providers ?? NO_PROVIDERS);
  const providers = healthProviders.length ? healthProviders : catalogProviders;
  const defaults = useAppStore((s) => s.models?.defaults ?? null);
  const [query, setQuery] = useState('');

  const byProvider = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter((m) => `${m.id} ${m.label} ${m.vendor}`.toLowerCase().includes(q))
      : models;
    const groups = new Map<string, ModelInfo[]>();
    for (const m of filtered) {
      const list = groups.get(m.provider) ?? [];
      list.push(m);
      groups.set(m.provider, list);
    }
    // ready providers first, then the rest
    const order = [...groups.entries()].sort((a, b) => {
      const sa = providerStatus(providers, a[0]);
      const sb = providerStatus(providers, b[0]);
      return rank(sa) - rank(sb) || a[0].localeCompare(b[0]);
    });
    return order;
  }, [models, providers, query]);

  const selected = value ? models.find((m) => m.id === value) : null;
  const autoLabel = selected
    ? prettyModelId(selected.id)
    : defaults && modelClass && defaults[modelClass]
      ? `${t('model.auto')} · ${prettyModelId(defaults[modelClass])}`
      : t('model.auto');

  return (
    <Dropdown
      width={380}
      align="start"
      className={className}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:border-[#46505e] hover:text-text',
            open && 'border-accent/50 text-text',
            compact && 'px-2 py-1 text-[11.5px]',
          )}
          title={t('model.title')}
        >
          <Cpu size={13} className={cn(selected ? 'text-info' : 'text-accent')} />
          <span className="max-w-[190px] truncate">{autoLabel}</span>
          <ChevronDown size={13} className="text-dim" />
        </button>
      )}
    >
      <div className="p-1">
        <div className="relative mb-1">
          <Search size={13} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-dim" />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('model.searchPlaceholder')}
            className="!py-1.5 !text-[12px] ps-7"
            autoFocus
          />
        </div>

        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            'flex w-full items-start gap-2 rounded-md px-2 py-2 text-start transition-colors hover:bg-line/70',
            value === null && 'bg-accent/10',
          )}
        >
          <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-medium text-text">{t('model.auto')}</span>
            <span className="block text-[11px] leading-snug text-dim">{t('model.autoHint')}</span>
          </span>
        </button>

        {showClass && onClassChange && modelClass ? (
          <div className="my-1.5 flex flex-wrap gap-1 border-y border-line py-1.5">
            {CLASSES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onClassChange(c)}
                className={cn(
                  'rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors',
                  modelClass === c
                    ? 'border-accent/50 bg-accent/12 text-accent'
                    : 'border-line-strong bg-surface text-dim hover:text-muted',
                )}
              >
                {t(`model.class.${c}` as never)}
              </button>
            ))}
          </div>
        ) : null}

        <div className="scroll-thin max-h-[320px] overflow-y-auto">
          {byProvider.length === 0 ? (
            <p className="px-2 py-3 text-[11.5px] text-dim">{t('model.noneCallable')}</p>
          ) : (
            byProvider.map(([provider, list]) => {
              const info = providers.find((p) => p.id === provider);
              const status = providerStatus(providers, provider);
              const usable = status === 'ready';
              return (
                <div key={provider} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 pb-1 pt-2">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-dim">
                      {info?.label ?? providerLabel(provider)}
                    </span>
                    <StatusBadge status={status} />
                    {info?.simulated ? <Badge tone="warning">echo</Badge> : null}
                  </div>
                  {list.map((m) => {
                    const active = value === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!usable || m.access === 'gated'}
                        onClick={() => onChange(m.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors',
                          active ? 'bg-accent/12' : 'hover:bg-line/70',
                          (!usable || m.access === 'gated') && 'opacity-45',
                        )}
                        title={m.notes ?? m.id}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-[12px]', active ? 'text-accent' : 'text-text')}>
                            {prettyModelId(m.id)}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            {m.supportsTools ? (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-info">
                                <Wrench size={9} /> {t('model.tools')}
                              </span>
                            ) : null}
                            <span className="text-[10px] text-dim">
                              {t('model.context')} {formatNumber(m.contextWindow)}
                            </span>
                            {m.freeTier === 'free' ? (
                              <span className="text-[10px] text-success">{t('model.free')}</span>
                            ) : m.freeTier === 'paid' ? (
                              <span className="text-[10px] text-warning">{t('model.paid')}</span>
                            ) : null}
                            {m.access === 'gated' ? (
                              <span className="text-[10px] text-danger">{t('model.gated')}</span>
                            ) : null}
                          </span>
                        </span>
                        {m.classes.includes('coding') ? <Badge tone="neutral">code</Badge> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dropdown>
  );
}

function providerStatus(providers: ProviderInfo[], id: string): string {
  return providers.find((p) => p.id === id)?.status ?? 'unreachable';
}

function rank(status: string): number {
  return status === 'ready' ? 0 : status === 'needs-remote' ? 1 : status === 'missing-key' ? 2 : 3;
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const tone: BadgeTone =
    status === 'ready' ? 'success' : status === 'needs-remote' ? 'warning' : status === 'missing-key' ? 'neutral' : 'danger';
  const known = ['ready', 'missing-key', 'needs-remote', 'unreachable', 'error', 'disabled', 'not-configured'];
  const label = known.includes(status)
    ? t(`providers.${status}` as Parameters<typeof t>[0])
    : status;
  return <Badge tone={tone}>{label}</Badge>;
}
