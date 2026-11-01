import { useEffect, useState } from 'react';
import type {
  AdminPendingOtpSummary, AdminSecurityConfigResponse, AdminUserSummary,
  LocalProviderKeysResponse, ModelClass, ModelInfo, ProviderId,
} from '@nova/shared';
import {
  Activity, Bot, Check, Cpu, Crown, Database, ExternalLink, Globe, Info, KeyRound, Lock, LogOut, Mail, RefreshCw, Send, ShieldCheck, TerminalSquare, Trash2, Users,
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

const PROVIDER_ORDER: ProviderId[] = ['gemini', 'groq', 'openrouter', 'workers-ai', 'custom', 'diagnostic'];

/** Stable empty reference — see the note in ModelPicker. */
const NO_MODELS: ModelInfo[] = [];

export function SettingsModal() {
  const { t, locale } = useI18n();
  const isAr = locale === 'ar';
  const open = useAppStore((s) => s.settingsOpen);
  const tab = useAppStore((s) => s.settingsTab);
  const openSettings = useAppStore((s) => s.openSettings);
  const authUser = useAppStore((s) => s.authUser);
  const health = useAppStore((s) => s.health);

  if (!open) return null;

  const canManageProviders = !health?.userAuthEnabled || authUser?.role === 'owner';
  const activeTab = tab === 'providers' && !canManageProviders ? 'general' : tab;

  return (
    <Modal
      open={open}
      onClose={() => openSettings(false)}
      title={t('settings.title')}
      subtitle={t('app.tagline')}
      width={780}
      footer={<Button variant="ghost" onClick={() => openSettings(false)}>{t('common.close')}</Button>}
    >
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <nav className="flex sm:flex-col shrink-0 gap-1 overflow-x-auto pb-2 sm:pb-0 sm:w-[160px] scroll-thin border-b sm:border-b-0 sm:border-e border-line -mx-1 px-1">
          <TabButton active={activeTab === 'general'} onClick={() => openSettings(true, 'general')} icon={<Globe size={13} />} label={t('settings.general')} />
          {authUser ? (
            <TabButton
              active={activeTab === 'account'}
              onClick={() => openSettings(true, 'account')}
              icon={<ShieldCheck size={13} />}
              label={isAr ? 'حسابي والأمان' : 'Account & Security'}
            />
          ) : null}
          {canManageProviders ? (
            <TabButton active={activeTab === 'providers'} onClick={() => openSettings(true, 'providers')} icon={<Cpu size={13} />} label={t('settings.providers')} />
          ) : null}
          <TabButton active={activeTab === 'agent'} onClick={() => openSettings(true, 'agent')} icon={<Bot size={13} />} label={t('settings.agent')} />
          <TabButton active={activeTab === 'storage'} onClick={() => openSettings(true, 'storage')} icon={<Database size={13} />} label={t('settings.storage')} />
        </nav>
        <div className="min-w-0 flex-1">
          {activeTab === 'general' ? <GeneralTab /> : null}
          {activeTab === 'account' && authUser ? <AccountSecurityTab /> : null}
          {activeTab === 'providers' && canManageProviders ? <ProvidersTab /> : null}
          {activeTab === 'agent' ? <AgentTab /> : null}
          {activeTab === 'storage' ? <StorageTab /> : null}
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
        'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 sm:py-2 text-start text-[12px] sm:text-[12.5px] transition-colors whitespace-nowrap',
        active ? 'bg-accent/15 font-semibold text-accent' : 'text-muted hover:bg-elevated hover:text-text',
      )}
    >
      {icon}
      <span>{label}</span>
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
  const { t, locale } = useI18n();
  const isAr = locale === 'ar';
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
    if (!models) {
      void refreshModels();
    }
  }, [models, refreshModels]);

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
  const ordered = PROVIDER_ORDER
    .map((id) => providers.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p && p.id !== 'diagnostic'));

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
          const canEditKey = Boolean(localKeys?.writable && (p.id === 'gemini' || p.id === 'openrouter' || p.id === 'custom' || p.id === 'groq'));
          return (
            <li key={p.id} className="rounded-lg border border-line bg-surface p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Dot tone={p.status === 'ready' ? 'success' : p.status === 'needs-remote' ? 'warning' : p.status === 'missing-key' ? 'neutral' : 'danger'} />
                <span className="text-[12.5px] font-medium text-text">
                  {t(`providers.${p.id}` as never)}
                </span>
                <StatusBadge status={p.status} />
                {p.id === 'gemini' || p.id === 'openrouter' ? <Badge tone="success">{t('model.free')}</Badge> : null}
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
              {p.id === 'gemini' ? (
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent underline"
                >
                  <ExternalLink size={11} />
                  {isAr ? 'احصل على مفتاح Google AI Studio مجاني (بدون بطاقة)' : 'Get a free Google Gemini key (no card)'}
                </a>
              ) : p.id === 'openrouter' ? (
                <a
                  href="https://openrouter.ai/settings/keys"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent underline"
                >
                  <ExternalLink size={11} />
                  {t('providers.getFreeKey')}
                </a>
              ) : p.id === 'groq' ? (
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent underline"
                >
                  <ExternalLink size={11} />
                  {isAr ? 'احصل على مفتاح Groq مجاني' : 'Get free Groq key'}
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
                      placeholder={
                        p.id === 'gemini'
                          ? 'AIzaSy...'
                          : p.id === 'openrouter'
                            ? 'sk-or-v1-...'
                            : p.id === 'groq'
                              ? 'gsk_...'
                              : t('providers.keyInputPlaceholder')
                      }
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
            if (!models && ready.size > 0) {
              return (
                <div className="flex items-center gap-2 py-1 text-dim">
                  <Spinner size={12} /> <span className="text-[11.5px]">{t('common.loading')}</span>
                </div>
              );
            }
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

/* ----------------------------------------------------- account & security */

function AccountSecurityTab() {
  const { locale } = useI18n();
  const isAr = locale === 'ar';
  const authUser = useAppStore((s) => s.authUser);
  const logout = useAppStore((s) => s.logout);
  const toast = useAppStore((s) => s.toast);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [pendingOtps, setPendingOtps] = useState<AdminPendingOtpSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [secCfg, setSecCfg] = useState<AdminSecurityConfigResponse | null>(null);
  const [mailerProvider, setMailerProvider] = useState<'none' | 'gmail' | 'brevo' | 'resend'>('gmail');
  const [senderEmail, setSenderEmail] = useState('');
  const [mailerSecret, setMailerSecret] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [otpRequired, setOtpRequired] = useState(true);
  const [strictTrustedOnly, setStrictTrustedOnly] = useState(false);
  const [savingSec, setSavingSec] = useState(false);
  const [testingOtp, setTestingOtp] = useState(false);

  const loadAdminData = async () => {
    if (authUser?.role !== 'owner') return;
    setLoadingUsers(true);
    try {
      const [usersRes, secRes, pendingRes] = await Promise.all([
        api.adminUsers(),
        api.adminGetSecurityConfig().catch(() => null),
        api.adminPendingOtps().catch(() => ({ pending: [] as AdminPendingOtpSummary[] })),
      ]);
      setUsers(usersRes.users);
      setPendingOtps(pendingRes.pending);
      if (secRes) {
        setSecCfg(secRes);
        setOtpRequired(secRes.otpRequired);
        setStrictTrustedOnly(secRes.strictTrustedDomainsOnly);
        setMailerProvider(secRes.mailerProvider === 'none' ? 'gmail' : secRes.mailerProvider);
        setSenderEmail(secRes.senderEmail || authUser.email);
        setGoogleClientId(secRes.googleClientId || '');
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    void loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.role]);

  if (!authUser) return null;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPw(true);
    try {
      await api.authChangePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      toast({
        kind: 'success',
        message: isAr ? 'تم تحديث كلمة المرور وإلغاء الجلسات الأخرى بنجاح.' : 'Password updated and other sessions revoked.',
      });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setSavingPw(false);
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSec(true);
    try {
      const saved = await api.adminSaveSecurityConfig({
        otpRequired,
        strictTrustedDomainsOnly: strictTrustedOnly,
        mailerProvider,
        senderEmail: senderEmail.trim(),
        secret: mailerSecret.trim() || undefined,
        googleClientId: googleClientId.trim(),
      });
      setSecCfg(saved);
      setMailerSecret('');
      toast({
        kind: 'success',
        message: isAr
          ? 'تم حفظ إعدادات الحماية والتحقق (OTP) بنجاح!'
          : 'OTP & anti-fake email security settings saved!',
      });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setSavingSec(false);
    }
  };

  const handleTestOtp = async () => {
    setTestingOtp(true);
    try {
      const res = await api.adminTestOtp(authUser.email);
      toast({
        kind: 'success',
        message: isAr
          ? `تم إرسال رمز OTP تجريبي بنجاح إلى ${res.sentTo}! تفقد صندوق الوارد.`
          : `Test OTP sent to ${res.sentTo}!`,
      });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setTestingOtp(false);
    }
  };

  const handleApprovePending = async (pendingEmail: string) => {
    try {
      const { user } = await api.adminApprovePending(pendingEmail);
      setPendingOtps((prev) => prev.filter((p) => p.email !== pendingEmail));
      setUsers((prev) => [user, ...prev]);
      toast({
        kind: 'success',
        message: isAr ? `تم تفعيل حساب ${user.email} بنجاح.` : `Activated ${user.email}.`,
      });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    }
  };

  const handleQuotaAction = async (userId: string, action: 'reset' | 'lock_week') => {
    try {
      const { user } = await api.adminUserQuota(userId, { action });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
      toast({
        kind: 'success',
        message:
          action === 'reset'
            ? isAr
              ? 'تم تصفير حد المستخدم وتفعيل رصيده فوراً.'
              : 'User quota reset.'
            : isAr
              ? 'تم إيقاف حد المستخدم لمدة أسبوع.'
              : 'User locked for 1 week.',
      });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    }
  };

  return (
    <div className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pe-1">
      {/* Profile & Quota Card */}
      <div className="rounded-xl border border-line bg-surface p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'grid h-9 w-9 place-items-center rounded-xl text-[13px] font-bold',
                authUser.role === 'owner'
                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/35'
                  : 'bg-accent/15 text-accent',
              )}
            >
              {authUser.role === 'owner' ? <Crown size={17} /> : authUser.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-[13px] font-semibold text-text">{authUser.displayName}</p>
              <p className="font-mono text-[11px] text-dim">{authUser.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {authUser.role === 'owner' ? (
              <Badge tone="warning">{isAr ? '👑 المالك · غير محدود (∞)' : '👑 Owner · Unlimited (∞)'}</Badge>
            ) : authUser.quota.locked ? (
              <Badge tone="danger">{isAr ? '⛔ منتهي (يتجدد بعد أسبوع)' : '⛔ Weekly Lockout'}</Badge>
            ) : (
              <Badge tone="success">
                {isAr
                  ? `الحد اليومي: ${authUser.quota.used} / ${authUser.quota.limit}`
                  : `Daily Quota: ${authUser.quota.used} / ${authUser.quota.limit}`}
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => void logout()}>
              <LogOut size={12} />
              {isAr ? 'خروج' : 'Sign Out'}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-[11.5px] text-dim">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-400" />
          <span>
            {authUser.role === 'owner'
              ? isAr
                ? 'أنت مالك المنصة — لا يوجد عليك أي حد يومي مطلقاً، وجميع محادثاتك ومشاريعك ومفاتيحك محمية ومعزولة تماماً.'
                : 'You are the platform owner — zero daily limits, full administrative control, and complete data isolation.'
              : authUser.quota.locked
                ? isAr
                  ? `خلاص انتهى حدّك اليومي بالكامل! يتجدد رصيدك تلقائياً بعد أسبوع بتاريخ ${authUser.quota.lockedUntil?.slice(0, 10) ?? ''}.`
                  : `Your daily limit ran out! Your quota automatically renews in 1 week on ${authUser.quota.lockedUntil?.slice(0, 10) ?? ''}.`
                : isAr
                  ? `خصوصيتك معزولة 100% عن بقية المستخدمين. استهلاكك اليومي الحالي ${authUser.quota.used} من ${authUser.quota.limit} (ملاحظة: عند انتهاء الحد بالكامل يتجدد بعد أسبوع).`
                  : `Your data is 100% isolated. Current daily usage: ${authUser.quota.used} / ${authUser.quota.limit} (if exhausted, renews after 1 week).`}
          </span>
        </div>
      </div>

      {/* Owner Anti-Fake Email + OTP Verification Setup */}
      {authUser.role === 'owner' ? (
        <form onSubmit={handleSaveSecurity} className="rounded-xl border border-accent/30 bg-surface p-3.5">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-accent">
              <Mail size={14} />
              {isAr
                ? 'حماية التسجيل — رمز التحقق (OTP) ومنع الحسابات الوهمية ($0 مجاناً)'
                : 'Sign-Up Shield — Real Email OTP & Anti-Fake Protection ($0 Free)'}
            </p>
            {secCfg?.hasSecret ? (
              <Badge tone="success">
                {isAr ? `مفعّل (${secCfg.maskedSecret ?? 'محفوظ'})` : `Active (${secCfg.maskedSecret ?? 'saved'})`}
              </Badge>
            ) : (
              <Badge tone="warning">
                {isAr ? 'بانتظار ربط بريد الإرسال المجاني' : 'Needs Free Mailer Key'}
              </Badge>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <Switch
              checked={otpRequired}
              onChange={setOtpRequired}
              label={
                isAr
                  ? 'فرض التحقق برمز OTP مكوّن من 6 أرقام لكل مستخدم جديد (منع التسجيل الوهمي نهائياً)'
                  : 'Require 6-digit email OTP for all new accounts'
              }
            />
            <Switch
              checked={strictTrustedOnly}
              onChange={setStrictTrustedOnly}
              label={
                isAr
                  ? 'حصر التسجيل على مزوّدي البريد الرسميين فقط (Gmail / Outlook / Hotmail / iCloud / Yahoo / Proton)'
                  : 'Allow major trusted email providers only (Gmail, Outlook, iCloud, Yahoo, Proton)'
              }
            />

            <div className="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2">
              <Field label={isAr ? 'مزوّد إرسال رموز OTP المجاني' : 'Free OTP Mailer Provider'}>
                <Select
                  value={mailerProvider}
                  onChange={(e) => setMailerProvider(e.target.value as 'none' | 'gmail' | 'brevo' | 'resend')}
                >
                  <option value="gmail">
                    {isAr ? 'Gmail مجاني ($0) — Google App Password (موصى به)' : 'Gmail Free ($0) — App Password'}
                  </option>
                  <option value="brevo">
                    {isAr ? 'Brevo API مجاني (300 رسالة/يوم)' : 'Brevo Free HTTP API (300/day)'}
                  </option>
                  <option value="resend">Resend HTTP API</option>
                  <option value="none">
                    {isAr ? 'بدون إرسال تلقائي (اعتماد يدوي من المالك)' : 'Manual Owner Approval Only'}
                  </option>
                </Select>
              </Field>

              <Field label={isAr ? 'بريد المرسل (حسابك)' : 'Sender Email'}>
                <TextInput
                  type="email"
                  dir="ltr"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="yousifalhooti23@gmail.com"
                />
              </Field>
            </div>

            {mailerProvider !== 'none' ? (
              <Field
                label={
                  mailerProvider === 'gmail'
                    ? isAr
                      ? 'كلمة مرور تطبيقات Google (16 حرفاً — بدون بطاقة وبـ 0 ريال)'
                      : 'Google App Password (16 chars — $0 Free)'
                    : isAr
                      ? 'مفتاح API لمزوّد البريد'
                      : 'Mailer API Key'
                }
                hint={
                  mailerProvider === 'gmail'
                    ? isAr
                      ? 'تُنشأ في 20 ثانية من حساب Google لإرسال 500 رمز OTP يومياً مجاناً دون كشف كلمة مرور بريدك الأساسية.'
                      : 'Generate in 20 seconds from your Google Account to send up to 500 free OTP emails/day.'
                    : undefined
                }
              >
                <div className="flex flex-col gap-1.5">
                  <TextInput
                    type="password"
                    dir="ltr"
                    value={mailerSecret}
                    onChange={(e) => setMailerSecret(e.target.value)}
                    placeholder={
                      secCfg?.hasSecret
                        ? isAr
                          ? `محفوظ حالياً (${secCfg.maskedSecret}) — اتركه فارغاً للإبقاء عليه`
                          : `Saved (${secCfg.maskedSecret}) — leave blank to keep`
                        : mailerProvider === 'gmail'
                          ? 'xxxx xxxx xxxx xxxx'
                          : 'xkeysib-... / re_...'
                    }
                    className="font-mono"
                  />
                  {mailerProvider === 'gmail' ? (
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex w-fit items-center gap-1 text-[11.5px] font-medium text-accent underline"
                    >
                      <ExternalLink size={11} />
                      {isAr
                        ? 'اضغط هنا لفتح صفحة Google App Passwords وإنشاء كود من 16 حرفاً مجاناً'
                        : 'Open Google App Passwords to create a free 16-char code'}
                    </a>
                  ) : null}
                </div>
              </Field>
            ) : null}

            <Field
              label={isAr ? 'معرّف Google Client ID (اختياري — لزر الدخول السريع عبر Google)' : 'Google OAuth Client ID (Optional)'}
            >
              <TextInput
                dir="ltr"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                placeholder="1234567890-abcdefg.apps.googleusercontent.com"
                className="font-mono !text-[11.5px]"
              />
            </Field>

            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              {secCfg?.hasSecret ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  icon={<Send size={12} />}
                  loading={testingOtp}
                  onClick={() => void handleTestOtp()}
                >
                  {isAr ? 'إرسال OTP تجريبي لبريدي' : 'Send Test OTP'}
                </Button>
              ) : null}
              <Button type="submit" size="sm" variant="primary" icon={<Check size={12} />} loading={savingSec}>
                {isAr ? 'حفظ إعدادات التحقق' : 'Save OTP Settings'}
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      {/* Pending OTP Registrations Queue (Owner Manual Approval Fallback) */}
      {authUser.role === 'owner' && pendingOtps.length > 0 ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3.5">
          <p className="mb-2 text-[12px] font-semibold text-amber-300">
            {isAr
              ? `⏳ طلبات تسجيل بانتظار تأكيد OTP (${pendingOtps.length})`
              : `⏳ Pending OTP Sign-Ups (${pendingOtps.length})`}
          </p>
          <div className="space-y-1.5">
            {pendingOtps.map((p) => (
              <div
                key={p.email}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-[11.5px]"
              >
                <div>
                  <span className="font-medium text-text">{p.displayName}</span>
                  <span className="ms-2 font-mono text-[11px] text-dim">{p.email}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => void handleApprovePending(p.email)}>
                  {isAr ? 'تفعيل يدوي' : 'Approve'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Password Change */}
      <form onSubmit={handlePasswordChange} className="rounded-xl border border-line bg-surface p-3.5">
        <p className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-text">
          <Lock size={13} className="text-accent" />
          {isAr ? 'تغيير كلمة المرور' : 'Change Password'}
        </p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label={isAr ? 'كلمة المرور الحالية' : 'Current Password'} htmlFor="pw-cur">
            <TextInput
              id="pw-cur"
              type="password"
              dir="ltr"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Field label={isAr ? 'كلمة المرور الجديدة (8+ أحرف)' : 'New Password (8+ chars)'} htmlFor="pw-new">
            <TextInput
              id="pw-new"
              type="password"
              dir="ltr"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
        </div>
        <div className="mt-2.5 flex justify-end">
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={savingPw}
            disabled={savingPw || !currentPassword || newPassword.length < 8}
          >
            {isAr ? 'تحديث كلمة المرور' : 'Update Password'}
          </Button>
        </div>
      </form>

      {/* Owner User Management Panel */}
      {authUser.role === 'owner' ? (
        <div className="rounded-xl border border-amber-400/25 bg-surface p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-300">
              <Users size={14} />
              {isAr ? 'لوحة المالك — المستخدمون المسجّلون والحد اليومي' : 'Owner Panel — Registered Users & Quotas'}
            </p>
            <Button size="sm" variant="ghost" onClick={() => void loadAdminData()} loading={loadingUsers}>
              <RefreshCw size={12} />
            </Button>
          </div>

          <div className="max-h-[210px] space-y-1.5 overflow-y-auto pe-1">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg/60 px-2.5 py-2 text-[11.5px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text">
                    {u.displayName}{' '}
                    {u.role === 'owner' ? (
                      <span className="text-[10px] text-amber-300">{isAr ? '(المالك)' : '(Owner)'}</span>
                    ) : null}
                  </p>
                  <p className="truncate font-mono text-[10.5px] text-dim">{u.email}</p>
                </div>

                <div className="flex items-center gap-1.5">
                  {u.role === 'owner' ? (
                    <Badge tone="warning">{isAr ? 'غير محدود ∞' : 'Unlimited ∞'}</Badge>
                  ) : (
                    <>
                      <Badge tone={u.quota.locked ? 'danger' : 'neutral'}>
                        {u.quota.locked
                          ? isAr
                            ? `موقوف حتى ${u.quota.lockedUntil?.slice(0, 10) ?? ''}`
                            : `Locked (${u.quota.lockedUntil?.slice(0, 10) ?? ''})`
                          : `${u.quota.used}/${u.quota.limit}`}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => void handleQuotaAction(u.id, 'reset')}>
                        {isAr ? 'تصفير الحد' : 'Reset'}
                      </Button>
                      {!u.quota.locked ? (
                        <Button size="sm" variant="ghost" onClick={() => void handleQuotaAction(u.id, 'lock_week')}>
                          {isAr ? 'إيقاف أسبوع' : 'Lock 7d'}
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
