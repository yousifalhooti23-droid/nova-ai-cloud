import { useEffect, useState } from 'react';
import type { LocalProviderKeysResponse, ModelClass, ModelInfo, ProviderId } from '@nova/shared';
import {
  Activity, Bot, Check, Cpu, Database, ExternalLink, Globe, Info, KeyRound, RefreshCw, ShieldCheck, TerminalSquare, Trash2,
} from 'lucide-react';
import { LOCALES, useI18n, type Locale } from '@/i18n';
import { cn } from '@/lib/cn';
import { api, describeApiError, getStoredAccessToken, setStoredAccessToken } from '@/lib/api';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { useCodeStore } from '@/store/code';
import { StatusBadge } from '@/components/chat/ModelPicker';
import {
  Badge, Button, Dot, Field, Modal, Select, Spinner, Switch, TextArea, TextInput,
} from '@/components/ui';

const PROVIDER_ORDER: ProviderId[] = ['workers-ai', 'openrouter', 'groq', 'custom', 'diagnostic'];

/** Stable empty reference — see the note in ModelPicker. */
const NO_MODELS: ModelInfo[] = [];

export function SettingsModal() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.settingsOpen);
  const tab = useAppStore((s) => s.settingsTab);
  const openSettings = useAppStore((s) => s.openSettings);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={() => openSettings(false)}
      title={t('settings.title')}
      subtitle={t('app.tagline')}
      width={760}
      footer={<Button variant="ghost" onClick={() => openSettings(false)}>{t('common.close')}</Button>}
    >
      <div className="flex gap-4">
        <nav className="flex w-[150px] shrink-0 flex-col gap-0.5">
          <TabButton active={tab === 'general'} onClick={() => openSettings(true, 'general')} icon={<Globe size={13} />} label={t('settings.general')} />
          <TabButton active={tab === 'providers'} onClick={() => openSettings(true, 'providers')} icon={<Cpu size={13} />} label={t('settings.providers')} />
          <TabButton active={tab === 'agent'} onClick={() => openSettings(true, 'agent')} icon={<Bot size={13} />} label={t('settings.agent')} />
          <TabButton active={tab === 'storage'} onClick={() => openSettings(true, 'storage')} icon={<Database size={13} />} label={t('settings.storage')} />
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'general' ? <GeneralTab /> : null}
          {tab === 'providers' ? <ProvidersTab /> : null}
          {tab === 'agent' ? <AgentTab /> : null}
          {tab === 'storage' ? <StorageTab /> : null}
        </div>
      </div>
    </Modal>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[12.5px] transition-colors',
        active ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-elevated hover:text-text',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ---------------------------------------------------------------- general */

function GeneralTab() {
  const { t, locale } = useI18n();
  const setLocale = useAppStore((s) => s.setLocale);
  const editorFontSize = useAppStore((s) => s.editorFontSize);
  const editorWrap = useAppStore((s) => s.editorWrap);
  const patchPrefs = useAppStore((s) => s.patchPrefs);
  const models = useAppStore((s) => s.models?.models ?? NO_MODELS);
  const health = useAppStore((s) => s.health);
  const composer = useChatStore((s) => s.composer);
  const setComposer = useChatStore((s) => s.setComposer);
  const agent = useCodeStore((s) => s.agent);
  const setAgent = useCodeStore((s) => s.setAgent);
  const settings = useAppStore((s) => s.settings);
  const refreshModels = useAppStore((s) => s.refreshModels);
  const toast = useAppStore((s) => s.toast);
  const [systemPrompt, setSystemPrompt] = useState(composer.systemPrompt);
  const [saving, setSaving] = useState(false);

  const ready = new Set((health?.providers ?? []).filter((p) => p.status === 'ready').map((p) => p.id));
  const usable = models.filter((m) => ready.has(m.provider) && m.access === 'open');

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('settings.language')} hint={t('settings.languageHint')}>
        <div className="flex gap-1.5">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => void setLocale(l.id as Locale)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors',
                locale === l.id ? 'border-accent/50 bg-accent/12 text-accent' : 'border-line-strong bg-surface text-muted hover:text-text',
              )}
            >
              {l.label}
              <span className="ms-1.5 font-mono text-[10px] text-dim">{l.dir.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('settings.defaultChatModel')}>
          <Select
            value={composer.modelId ?? ''}
            onChange={(e) => setComposer({ modelId: e.target.value || null })}
          >
            <option value="">{t('model.auto')}</option>
            {usable.filter((m) => m.classes.includes('chat')).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.defaultCodeModel')}>
          <Select
            value={agent.modelIdOverride ?? settings?.defaults?.coding ?? ''}
            onChange={async (e) => {
              const value = e.target.value || null;
              setAgent({ modelIdOverride: value });
              setSaving(true);
              try {
                const base: Record<ModelClass, string | null> = settings?.defaults ?? { chat: null, reasoning: null, coding: null, 'long-context': null };
                await api.updateSettings({ defaults: { ...base, coding: value } });
                await refreshModels();
              } catch (err) {
                toast({ kind: 'error', message: describeApiError(err).message });
              } finally {
                setSaving(false);
              }
            }}
          >
            <option value="">{t('model.auto')}</option>
            {usable.filter((m) => m.classes.includes('coding')).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={t('settings.systemPrompt')} hint={t('settings.systemPromptHint')}>
        <TextArea
          rows={3}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          onBlur={() => setComposer({ systemPrompt })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('settings.fontSize')}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={11}
              max={18}
              value={editorFontSize}
              onChange={(e) => patchPrefs({ editorFontSize: Number(e.target.value) })}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-8 font-mono text-[11.5px] text-dim">{editorFontSize}</span>
          </div>
        </Field>
        <Field label={t('settings.temperature')}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={composer.temperature}
              onChange={(e) => setComposer({ temperature: Number(e.target.value) })}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-8 font-mono text-[11.5px] text-dim">{composer.temperature.toFixed(1)}</span>
          </div>
        </Field>
      </div>

      <Switch checked={editorWrap} onChange={(v) => patchPrefs({ editorWrap: v })} label={t('settings.lineWrap')} />

      {health?.authProtected || getStoredAccessToken() ? (
        <AccessTokenField />
      ) : null}

      <p className="text-[11px] text-dim">
        {t('model.verified', { date: useAppStore.getState().models?.catalogVerifiedAt ?? '—' })}
      </p>
    </div>
  );
}

function AccessTokenField() {
  const { t } = useI18n();
  const refreshHealth = useAppStore((s) => s.refreshHealth);
  const refreshModels = useAppStore((s) => s.refreshModels);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const toast = useAppStore((s) => s.toast);
  const [token, setToken] = useState(() => getStoredAccessToken());

  const apply = async () => {
    setStoredAccessToken(token);
    await Promise.all([refreshHealth(), refreshModels(), loadSettings()]);
    toast({ kind: 'success', message: t('common.success') });
  };

  return (
    <Field label={t('settings.accessToken')} hint={t('settings.accessTokenHint')}>
      <div className="flex gap-2">
        <TextInput
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('settings.accessTokenPlaceholder')}
          dir="ltr"
        />
        <Button size="sm" variant="outline" onClick={() => void apply()}>
          {t('common.save')}
        </Button>
      </div>
    </Field>
  );
}

/* -------------------------------------------------------------- providers */

function ProvidersTab() {
  const { t } = useI18n();
  const health = useAppStore((s) => s.health);
  const models = useAppStore((s) => s.models);
  const refreshCatalog = useAppStore((s) => s.refreshCatalog);
  const refreshHealth = useAppStore((s) => s.refreshHealth);
  const refreshModels = useAppStore((s) => s.refreshModels);
  const probeWorkersAi = useAppStore((s) => s.probeWorkersAi);
  const probe = useAppStore((s) => s.probe);
  const toast = useAppStore((s) => s.toast);
  const [busy, setBusy] = useState<'' | 'catalog' | 'probe' | ProviderId>('');
  const [localKeys, setLocalKeys] = useState<LocalProviderKeysResponse | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [baseUrlInput, setBaseUrlInput] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getLocalProviderKeys();
        if (!cancelled) {
          setLocalKeys(res);
          const customEntry = res.keys.find((k) => k.provider === 'custom');
          if (customEntry?.baseUrl) setBaseUrlInput(customEntry.baseUrl);
        }
      } catch {
        if (!cancelled) setLocalKeys(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveKey = async (provider: ProviderId) => {
    const apiKey = (keyInputs[provider] ?? '').trim();
    const baseUrl = provider === 'custom' ? baseUrlInput.trim() : undefined;
    if (provider !== 'custom' && !apiKey) return;
    if (provider === 'custom' && !baseUrl) return;
    setBusy(provider);
    try {
      await api.saveLocalProviderKey({ provider, apiKey: apiKey || undefined, baseUrl });
      setKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      const [updatedKeys] = await Promise.all([
        api.getLocalProviderKeys().catch(() => null),
        refreshHealth(),
        refreshModels(),
      ]);
      if (updatedKeys) setLocalKeys(updatedKeys);
      toast({ kind: 'success', message: t('providers.keySaved') });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setBusy('');
    }
  };

  const removeKey = async (provider: ProviderId) => {
    setBusy(provider);
    try {
      await api.saveLocalProviderKey({ provider, remove: true });
      if (provider === 'custom') setBaseUrlInput('');
      const [updatedKeys] = await Promise.all([
        api.getLocalProviderKeys().catch(() => null),
        refreshHealth(),
        refreshModels(),
      ]);
      if (updatedKeys) setLocalKeys(updatedKeys);
      toast({ kind: 'info', message: t('providers.keyRemoved') });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setBusy('');
    }
  };

  const providers = health?.providers ?? models?.providers ?? [];
  const ordered = PROVIDER_ORDER.map((id) => providers.find((p) => p.id === id)).filter(Boolean) as typeof providers;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/8 p-2.5">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-success">{t('providers.freeGuarantee')}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{t('providers.freeGuaranteeHint')}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface p-2.5">
        <KeyRound size={14} className="shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted">{t('providers.keyHint')}</p>
        <Button
          size="sm"
          variant="outline"
          icon={<RefreshCw size={12} />}
          loading={busy === 'catalog'}
          onClick={async () => {
            setBusy('catalog');
            await refreshCatalog();
            setBusy('');
          }}
        >
          {t('providers.refreshCatalog')}
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {ordered.map((p) => {
          const count = models?.models.filter((m) => m.provider === p.id).length ?? p.modelCount;
          const keyMeta = localKeys?.keys.find((k) => k.provider === p.id);
          const canEditKey = Boolean(localKeys?.writable && (p.id === 'openrouter' || p.id === 'custom' || p.id === 'groq'));
          return (
            <li key={p.id} className="rounded-lg border border-line bg-surface p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Dot tone={p.status === 'ready' ? 'success' : p.status === 'needs-remote' ? 'warning' : p.status === 'missing-key' ? 'neutral' : 'danger'} />
                <span className="text-[12.5px] font-medium text-text">
                  {t(`providers.${p.id}` as never)}
                </span>
                <StatusBadge status={p.status} />
                {p.id === 'openrouter' ? <Badge tone="success">{t('model.free')}</Badge> : null}
                {p.simulated ? <Badge tone="warning">echo — {t('providers.diagnostic')}</Badge> : null}
                {keyMeta?.masked ? (
                  <Badge tone="neutral">{t('providers.savedMask', { mask: keyMeta.masked })}</Badge>
                ) : null}
                <span className="ms-auto text-[11px] text-dim">{t('providers.models', { n: count })}</span>
                {p.id === 'workers-ai' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Activity size={12} />}
                    loading={busy === 'probe'}
                    onClick={async () => {
                      setBusy('probe');
                      await probeWorkersAi();
                      setBusy('');
                    }}
                  >
                    {t('providers.probe')}
                  </Button>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">{p.detail}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-dim/80">{t(`providers.${p.id}.hint` as never)}</p>
              {p.id === 'openrouter' ? (
                <a
                  href="https://openrouter.ai/settings/keys"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent underline"
                >
                  <ExternalLink size={11} />
                  {t('providers.getFreeKey')}
                </a>
              ) : p.docsUrl ? (
                <a href={p.docsUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-[11px] text-info underline">
                  {p.docsUrl}
                </a>
              ) : null}

              {canEditKey ? (
                <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5">
                  {p.id === 'custom' ? (
                    <TextInput
                      value={baseUrlInput}
                      onChange={(e) => setBaseUrlInput(e.target.value)}
                      placeholder={t('providers.baseUrlPlaceholder')}
                      dir="ltr"
                      className="font-mono !text-[11.5px]"
                    />
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <TextInput
                      type="password"
                      value={keyInputs[p.id] ?? ''}
                      onChange={(e) => setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void saveKey(p.id);
                        }
                      }}
                      placeholder={t('providers.keyInputPlaceholder')}
                      dir="ltr"
                      className="min-w-[200px] flex-1 font-mono !text-[11.5px]"
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Check size={12} />}
                      loading={busy === p.id}
                      disabled={p.id === 'custom' ? !baseUrlInput.trim() : !(keyInputs[p.id] ?? '').trim()}
                      onClick={() => void saveKey(p.id)}
                    >
                      {t('providers.saveKey')}
                    </Button>
                    {keyMeta?.configured ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={12} />}
                        loading={busy === p.id}
                        onClick={() => void removeKey(p.id)}
                      >
                        {t('providers.removeKey')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {probe ? (
        <div className="rounded-lg border border-line bg-surface p-2.5">
          <p className="text-[11.5px] text-muted">
            {t('providers.probed')}: <span className="font-mono">{JSON.stringify(probe)}</span>
          </p>
        </div>
      ) : null}

      <div className="rounded-lg border border-line bg-surface p-2.5">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
          <Cpu size={12} className="text-accent" /> {t('providers.callableModels')}
        </p>
        {(() => {
          const ready = new Set(providers.filter((p) => p.status === 'ready').map((p) => p.id));
          const list = (models?.models ?? []).filter((m) => ready.has(m.provider) && m.access === 'open');
          if (list.length === 0) {
            return (
              <div className="flex items-start gap-2">
                <Badge tone="warning">{t('providers.noCallable')}</Badge>
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-dim">{t('providers.noCallableHint')}</p>
              </div>
            );
          }
          return (
            <div className="flex flex-wrap gap-1">
              {list.slice(0, 24).map((m) => (
                <span key={m.id} className="chip !py-0.5 font-mono !text-[10.5px]" title={`${m.id} · ${m.contextWindow} ctx`}>
                  {m.label}
                  {m.freeTier === 'free' ? <span className="text-success">•</span> : null}
                  {m.supportsTools ? <span className="text-info">⚒</span> : null}
                </span>
              ))}
              {list.length > 24 ? <span className="chip !py-0.5 text-[10.5px]">+{list.length - 24}</span> : null}
            </div>
          );
        })()}
      </div>

      <div className="rounded-lg border border-line bg-surface p-2.5">
        <p className="mb-1 text-[11.5px] font-medium text-muted">{t('providers.priority')}</p>
        <p className="text-[11px] leading-relaxed text-dim">{t('providers.priorityHint')}</p>
        <p className="mt-1.5 font-mono text-[11px] text-text">
          {(health?.providers ?? []).map((p) => p.id).join(' → ')}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ agent */

function AgentTab() {
  const { t } = useI18n();
  const settings = useAppStore((s) => s.settings);
  const sandbox = useAppStore((s) => s.sandbox);
  const agent = useCodeStore((s) => s.agent);
  const setAgent = useCodeStore((s) => s.setAgent);
  const toast = useAppStore((s) => s.toast);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const [maxSteps, setMaxSteps] = useState(settings?.agent.maxSteps ?? agent.maxSteps);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setMaxSteps(settings.agent.maxSteps);
  }, [settings]);

  const saveDefaults = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ agent: { maxSteps, autoApply: agent.autoApply, allowTerminal: agent.allowTerminal } });
      await loadSettings();
      toast({ kind: 'success', message: t('common.success') });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-lg border border-line bg-surface p-2.5">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-text">{t('sandbox.title')}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-dim">{t('sandbox.explainer')}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={sandbox?.ready ? 'success' : 'warning'}>
              <TerminalSquare size={10} /> {sandbox?.kind ?? 'unknown'}
            </Badge>
            <span className="text-[11px] text-dim">{sandbox?.detail}</span>
          </div>
          {sandbox?.isolationNotes?.length ? (
            <ul className="mt-1.5 list-disc ps-4 text-[11px] leading-relaxed text-dim">
              {sandbox.isolationNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <Field label={t('agent.maxSteps')} hint="1 – 30">
        <TextInput type="number" min={1} max={30} value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} className="!w-28" />
      </Field>

      <Switch
        checked={agent.autoApply}
        onChange={(v) => setAgent({ autoApply: v })}
        label={t('agent.autoApply')}
        hint={t('agent.autoApplyHint')}
      />
      <Switch
        checked={agent.allowTerminal}
        onChange={(v) => setAgent({ allowTerminal: v })}
        label={t('agent.allowTerminal')}
        hint={t('agent.allowTerminalHint')}
      />

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" loading={saving} onClick={() => void saveDefaults()}>
          {t('common.save')}
        </Button>
        <span className="text-[11px] text-dim">{t('settings.defaults')}</span>
      </div>

      <p className="text-[11px] leading-relaxed text-dim">{t('changes.requiresApproval')}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- storage */

function StorageTab() {
  const { t } = useI18n();
  const health = useAppStore((s) => s.health);
  const [usage, setUsage] = useState<{ records: number; tokensIn: number; tokensOut: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.usage(200);
        if (!cancelled) setUsage({ records: res.records.length, tokensIn: res.totals.tokensIn, tokensOut: res.totals.tokensOut });
      } catch {
        if (!cancelled) setUsage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <InfoCard
          icon={<Database size={13} />}
          label={t('storage.kind')}
          value={health?.store.kind === 'd1' ? t('storage.d1') : t('storage.memory')}
          tone={health?.store.ready ? 'success' : 'warning'}
          detail={health?.store.detail}
        />
        <InfoCard
          icon={<Database size={13} />}
          label={t('storage.blobs')}
          value={health?.blob.kind === 'r2' ? t('storage.r2') : health?.blob.kind ?? '—'}
          tone={health?.blob.ready ? 'success' : 'warning'}
        />
        <InfoCard
          icon={<ShieldCheck size={13} />}
          label={t('about.sandbox')}
          value={health?.sandbox.kind ?? '—'}
          tone={health?.sandbox.ready ? 'success' : 'warning'}
          detail={health?.sandbox.detail}
        />
        <InfoCard
          icon={<Activity size={13} />}
          label={t('nav.health')}
          value={health ? `${health.runtime} · v${health.version}` : t('health.checking')}
          tone={health?.ok ? 'success' : 'danger'}
        />
      </div>

      <p className="text-[11.5px] leading-relaxed text-dim">{t('storage.hint')}</p>

      {usage ? (
        <div className="rounded-lg border border-line bg-surface p-2.5">
          <p className="text-[11.5px] font-medium text-muted">Usage</p>
          <p className="mt-1 font-mono text-[11.5px] text-text">
            {usage.records} calls · {usage.tokensIn} in · {usage.tokensOut} out
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-dim">
          <Spinner size={12} /> <span className="text-[11.5px]">{t('common.loading')}</span>
        </div>
      )}

      <div className="rounded-lg border border-line bg-surface p-2.5">
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
          <Info size={12} className="text-accent" /> {t('settings.about')}
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{t('about.description')}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{t('about.stack')}</p>
        <p className="mt-1.5 font-mono text-[11px] text-dim">
          {t('about.version')}: {health?.version ?? '—'} · {t('about.sandbox')}: {health?.sandbox.kind ?? '—'}
        </p>
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail?: string; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-2.5">
      <p className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-dim">
        {icon} {label}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-text">
        <Dot tone={tone ?? 'neutral'} />
        {value}
      </p>
      {detail ? <p className="mt-1 text-[11px] leading-relaxed text-dim">{detail}</p> : null}
    </div>
  );
}
