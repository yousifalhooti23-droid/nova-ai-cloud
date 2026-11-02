import { useEffect, useState, useRef } from 'react';
import {
  Activity, ArrowLeft, Bot, Check, Cpu, Crown, Database, ExternalLink, KeyRound,
  Lock, RefreshCw, Server, ShieldCheck, TerminalSquare, Trash2, Zap,
} from 'lucide-react';
import type { ProviderId } from '@nova/shared';
import {
  api, describeApiError, getStoredAdminToken, setStoredAdminToken,
  type StudioBrainResponse, type StudioLogEntry, type StudioStorageResponse, type StudioTelemetryResponse,
} from '@/lib/api';
import { useAppStore } from '@/store/app';
import { Badge, Button, Dot, Field, Spinner, Switch, TextArea, TextInput } from '@/components/ui';
import { cn } from '@/lib/cn';
import { StudioAuthGate } from './StudioAuthGate';

type StudioTab = 'telemetry' | 'logs' | 'storage' | 'brain';

export function StudioDashboard() {
  const isAr = useAppStore((s) => s.locale === 'ar');
  const setView = useAppStore((s) => s.setView);
  const toast = useAppStore((s) => s.toast);

  const [authed, setAuthed] = useState<boolean>(() => Boolean(getStoredAdminToken()));
  const [tab, setTab] = useState<StudioTab>('telemetry');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Telemetry data
  const [telemetry, setTelemetry] = useState<StudioTelemetryResponse | null>(null);
  const [logs, setLogs] = useState<StudioLogEntry[]>([]);
  const [storage, setStorage] = useState<StudioStorageResponse | null>(null);
  const [brain, setBrain] = useState<StudioBrainResponse | null>(null);

  // Key inputs state
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [baseUrlInput, setBaseUrlInput] = useState<string>('');
  const [savingKey, setSavingKey] = useState<string>('');

  // Brain edit state
  const [masterPrompt, setMasterPrompt] = useState<string>('');
  const [defaultChatModel, setDefaultChatModel] = useState<string>('');
  const [defaultCodingModel, setDefaultCodingModel] = useState<string>('');
  const [savingBrain, setSavingBrain] = useState<boolean>(false);

  const logEndRef = useRef<HTMLDivElement>(null);

  const loadData = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [tRes, lRes, sRes, bRes] = await Promise.all([
        api.getStudioTelemetry().catch(() => null),
        api.getStudioLogs(80).catch(() => null),
        api.getStudioStorage().catch(() => null),
        api.getStudioBrain().catch(() => null),
      ]);

      if (tRes) setTelemetry(tRes);
      if (lRes) setLogs(lRes.logs);
      if (sRes) setStorage(sRes);
      if (bRes) {
        setBrain(bRes);
        setMasterPrompt(bRes.masterSystemPrompt || '');
        setDefaultChatModel(bRes.defaults?.chat || '');
        setDefaultCodingModel(bRes.defaults?.coding || '');
      }
    } catch {
      // Token might be expired
      setAuthed(false);
    } finally {
      if (!silent) setRefreshing(false);
    }
  };

  useEffect(() => {
    if (authed) {
      void loadData();
    }
  }, [authed]);

  // Auto-refresh interval
  useEffect(() => {
    if (!authed || !autoRefresh) return;
    const interval = setInterval(() => {
      void loadData(true);
    }, 4000);
    return () => clearInterval(interval);
  }, [authed, autoRefresh]);

  const handleLogout = () => {
    setStoredAdminToken('');
    setAuthed(false);
    toast({ kind: 'info', message: isAr ? 'تم قفل لوحة القيادة وتسجيل الخروج.' : 'NOVA Studio locked.' });
  };

  const handleSaveKey = async (provider: ProviderId) => {
    const apiKey = (keyInputs[provider] ?? '').trim();
    const baseUrl = provider === 'custom' ? baseUrlInput.trim() : undefined;
    if (provider !== 'custom' && !apiKey) return;
    setSavingKey(provider);
    try {
      await api.saveStudioProviderKey({ provider, apiKey: apiKey || undefined, baseUrl });
      setKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      toast({ kind: 'success', message: isAr ? `تم حفظ مفتاح ${provider} بنجاح!` : `Saved ${provider} key.` });
      await loadData(true);
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setSavingKey('');
    }
  };

  const handleDeleteKey = async (provider: ProviderId) => {
    setSavingKey(provider);
    try {
      await api.deleteStudioProviderKey(provider);
      toast({ kind: 'info', message: isAr ? `تم حذف مفتاح ${provider}.` : `Removed ${provider} key.` });
      await loadData(true);
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setSavingKey('');
    }
  };

  const handleSaveBrain = async () => {
    setSavingBrain(true);
    try {
      await api.saveStudioBrain({
        masterSystemPrompt: masterPrompt,
        defaults: {
          chat: defaultChatModel || null,
          coding: defaultCodingModel || null,
        },
      });
      toast({
        kind: 'success',
        message: isAr
          ? 'تم تحديث عقل نوفا وموجّه النظام الماستر بنجاح دون الحاجة لإعادة نشر الكود!'
          : 'Nova Master System Prompt & Model Defaults saved successfully!',
      });
      await loadData(true);
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setSavingBrain(false);
    }
  };

  if (!authed) {
    return <StudioAuthGate onSuccess={() => setAuthed(true)} onCancel={() => setView('chat')} />;
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0d14] text-slate-100 font-sans">
      {/* Top Futuristic Navigation Bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-amber-500/20 bg-[#0d121d]/90 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setView('chat')}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface/60 px-2.5 py-1.5 text-[12px] font-medium text-dim hover:text-text transition-colors"
          >
            <ArrowLeft size={13} className={isAr ? 'rotate-180' : ''} />
            <span>{isAr ? 'العودة للدردشة' : 'Back to Chat'}</span>
          </button>

          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl border border-amber-400/40 bg-amber-500/20 text-amber-300 shadow-sm">
              <Crown size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-bold text-amber-300 tracking-tight">NOVA Studio</span>
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  {isAr ? 'مركز القيادة' : 'MISSION CONTROL'}
                </span>
              </div>
              <p className="text-[10.5px] text-dim">
                yousifalhooti23@gmail.com · {telemetry?.runtime || 'Cloudflare Workers'} · v{telemetry?.version || '0.5.0'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-line/60 bg-surface/50 px-2.5 py-1 text-[11px] text-dim">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{isAr ? 'بث حي ومباشر' : 'Live Stream'}</span>
            <span className="text-dim/60">|</span>
            <Switch
              checked={autoRefresh}
              onChange={setAutoRefresh}
              label={isAr ? 'تحديث تلقائي (4ث)' : 'Auto-refresh'}
            />
          </div>

          <Button
            size="sm"
            variant="outline"
            icon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            loading={refreshing}
            onClick={() => void loadData()}
          >
            {isAr ? 'تحديث الآن' : 'Refresh'}
          </Button>

          <Button
            size="sm"
            variant="danger"
            icon={<Lock size={12} />}
            onClick={handleLogout}
            title={isAr ? 'قفل الاستوديو' : 'Lock Studio'}
          >
            {isAr ? 'قفل' : 'Lock'}
          </Button>
        </div>
      </header>

      {/* Tabs Sub-Header */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line/50 bg-[#0c101a] px-4 py-1.5 overflow-x-auto scroll-thin">
        <StudioTabButton
          active={tab === 'telemetry'}
          onClick={() => setTab('telemetry')}
          icon={<Activity size={14} />}
          label={isAr ? 'المزوّدون والمؤشرات (Telemetry)' : 'Live Telemetry & Keys'}
        />
        <StudioTabButton
          active={tab === 'logs'}
          onClick={() => setTab('logs')}
          icon={<TerminalSquare size={14} />}
          label={isAr ? 'سجلات الفشل والتحويل (Failover Logs)' : 'Live Logs & Failovers'}
          badge={logs.filter((l) => l.status === 'failover' || l.status === 'error').length}
        />
        <StudioTabButton
          active={tab === 'storage'}
          onClick={() => setTab('storage')}
          icon={<Database size={14} />}
          label={isAr ? 'التخزين والبيئة المعزولة (Storage & Sandbox)' : 'Storage & Sandbox'}
        />
        <StudioTabButton
          active={tab === 'brain'}
          onClick={() => setTab('brain')}
          icon={<Bot size={14} />}
          label={isAr ? 'عقل نوفا وتوجيهات النظام (AI Brain)' : 'AI Brain & Master Prompt'}
        />
      </div>

      {/* Main Studio Content Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-thin">
        {tab === 'telemetry' && (
          <div className="mx-auto max-w-6xl space-y-6">
            {/* Quick KPI Stat Cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                icon={<Server size={18} className="text-emerald-400" />}
                title={isAr ? 'المزوّدون النشطون' : 'Active Providers'}
                value={`${telemetry?.providers.filter((p) => p.status === 'ready').length ?? 0} / ${telemetry?.providers.length ?? 0}`}
                subtitle={isAr ? 'جاهزون لاستقبال الطلبات' : 'Ready for requests'}
                tone="success"
              />
              <StatCard
                icon={<Cpu size={18} className="text-accent" />}
                title={isAr ? 'إجمالي النماذج المتاحة' : 'Available Models'}
                value={String(telemetry?.totalModels ?? 0)}
                subtitle={isAr ? 'متاحة بدون بطاقة بنكية' : 'Callable without card'}
                tone="neutral"
              />
              <StatCard
                icon={<Zap size={18} className="text-amber-400" />}
                title={isAr ? 'ترتيب أولوية التحويل' : 'Failover Order'}
                value="4 مستويات"
                subtitle={(telemetry?.priorityOrder ?? ['openrouter', 'gemini', 'groq', 'workers-ai']).join(' → ')}
                tone="warning"
              />
              <StatCard
                icon={<ShieldCheck size={18} className="text-blue-400" />}
                title={isAr ? 'البيئة التشغيلية' : 'Runtime Isolate'}
                value={telemetry?.runtime ?? 'Cloudflare Worker'}
                subtitle={`v${telemetry?.version ?? '0.5.0'} · TLS Encrypted`}
                tone="neutral"
              />
            </div>

            {/* Provider Cards with Key Management */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-200">
                  {isAr ? 'حالة المزوّدين وإدارة المفاتيح المشفرة ($0 مجاناً)' : 'Provider Status & Key Management'}
                </h2>
                <span className="text-[11px] text-dim">
                  {isAr ? 'تُحفظ المفاتيح في قاعدة بيانات D1 مشفرة بالكامل' : 'Stored securely in Cloudflare D1 encrypted'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(telemetry?.providers ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="relative rounded-xl border border-line bg-[#0e1422] p-4 shadow-sm transition-all hover:border-line-strong"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Dot tone={p.status === 'ready' ? 'success' : p.status === 'missing-key' ? 'warning' : 'danger'} pulse={p.status === 'ready'} />
                        <span className="text-[13px] font-bold text-text">{p.label}</span>
                        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-dim">
                          {p.id}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-400">
                          {p.latencyMs} ms
                        </span>
                        <Badge tone={p.status === 'ready' ? 'success' : p.status === 'missing-key' ? 'warning' : 'danger'}>
                          {p.status}
                        </Badge>
                      </div>
                    </div>

                    <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{p.detail}</p>

                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-dim">
                        {isAr ? `النماذج: ${p.modelCount} نموذج` : `Models: ${p.modelCount}`}
                      </span>
                      {p.id === 'openrouter' ? (
                        <a
                          href="https://openrouter.ai/settings/keys"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 font-medium text-amber-400 underline hover:text-amber-300"
                        >
                          <ExternalLink size={11} />
                          {isAr ? 'مفتاح OpenRouter مجاني' : 'Get free OpenRouter key'}
                        </a>
                      ) : p.id === 'gemini' ? (
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 font-medium text-amber-400 underline hover:text-amber-300"
                        >
                          <ExternalLink size={11} />
                          {isAr ? 'مفتاح Google Gemini مجاني' : 'Get free Gemini key'}
                        </a>
                      ) : p.id === 'groq' ? (
                        <a
                          href="https://console.groq.com/keys"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 font-medium text-amber-400 underline hover:text-amber-300"
                        >
                          <ExternalLink size={11} />
                          {isAr ? 'مفتاح Groq مجاني' : 'Get free Groq key'}
                        </a>
                      ) : null}
                    </div>

                    {/* Key Management Form for Editable Providers */}
                    {['openrouter', 'gemini', 'groq', 'custom'].includes(p.id) && (
                      <div className="mt-3 border-t border-line/60 pt-3">
                        {p.id === 'custom' ? (
                          <div className="mb-2">
                            <TextInput
                              value={baseUrlInput}
                              onChange={(e) => setBaseUrlInput(e.target.value)}
                              placeholder="https://api.together.xyz/v1"
                              dir="ltr"
                              className="font-mono !text-[11px]"
                            />
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <TextInput
                            type="password"
                            dir="ltr"
                            value={keyInputs[p.id] ?? ''}
                            onChange={(e) => setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleSaveKey(p.id as ProviderId);
                              }
                            }}
                            placeholder={
                              p.id === 'gemini'
                                ? 'AIzaSy...'
                                : p.id === 'openrouter'
                                  ? 'sk-or-v1-...'
                                  : p.id === 'groq'
                                    ? 'gsk_...'
                                    : 'API Key...'
                            }
                            className="flex-1 font-mono !text-[11.5px]"
                          />
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<Check size={12} />}
                            loading={savingKey === p.id}
                            onClick={() => void handleSaveKey(p.id as ProviderId)}
                          >
                            {isAr ? 'حفظ وتفعيل' : 'Save'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 size={12} />}
                            loading={savingKey === p.id}
                            onClick={() => void handleDeleteKey(p.id as ProviderId)}
                            title={isAr ? 'حذف المفتاح' : 'Delete Key'}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'logs' && (
          <div className="mx-auto max-w-6xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-200">
                  {isAr ? 'شريط السجلات الحية ورصد التحويلات (Live Failover Stream)' : 'Real-time Request & Failover Stream'}
                </h2>
                <p className="text-[11.5px] text-dim">
                  {isAr
                    ? 'يتم رصد كل طلب، مزوّد الاستجابة، وأسباب التحويل التلقائي (مثل 429 Rate Limit) في الذاكرة الحلقية الحية.'
                    : 'Ring-buffer telemetry tracking every request, provider, and automatic failovers.'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setLogs([])}>
                  {isAr ? 'مسح العرض' : 'Clear View'}
                </Button>
                <Button size="sm" variant="outline" icon={<RefreshCw size={12} />} onClick={() => void loadData()}>
                  {isAr ? 'تحديث' : 'Refresh'}
                </Button>
              </div>
            </div>

            {/* Terminal Log Console */}
            <div className="overflow-hidden rounded-xl border border-line bg-[#070a10] shadow-2xl">
              <div className="flex items-center justify-between border-b border-line/60 bg-[#0c101a] px-3.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
                  <span className="ms-2 font-mono text-[11px] text-dim">nova-telemetry://live.stream</span>
                </div>
                <span className="font-mono text-[10.5px] text-dim">
                  {logs.length} {isAr ? 'سجل' : 'events'}
                </span>
              </div>

              <div className="max-h-[62vh] space-y-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed scroll-thin">
                {logs.length === 0 ? (
                  <p className="py-8 text-center text-dim">
                    {isAr ? 'لا توجد سجلات بعد — أرسل رسالة في الدردشة لمشاهدة السجلات الحية هنا.' : 'No logs recorded yet. Send a message to see live logs.'}
                  </p>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className={cn(
                        'flex flex-wrap items-start gap-2 rounded px-2 py-1 transition-colors',
                        log.status === 'failover'
                          ? 'border-s-2 border-amber-400 bg-amber-500/10 text-amber-200'
                          : log.status === 'error'
                            ? 'border-s-2 border-red-400 bg-red-500/10 text-red-200'
                            : 'hover:bg-white/5 text-slate-300',
                      )}
                    >
                      <span className="text-dim/70">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.2 font-bold text-[10px]',
                          log.status === 'success'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : log.status === 'failover'
                              ? 'bg-amber-500/25 text-amber-300'
                              : 'bg-red-500/25 text-red-300',
                        )}
                      >
                        {log.status.toUpperCase()}
                      </span>
                      <span className="font-semibold text-text">{log.provider}</span>
                      <span className="text-dim">({log.model})</span>
                      <span className="ms-auto text-emerald-400">{log.latencyMs}ms</span>

                      {log.failoverReason && (
                        <div className="w-full text-amber-300/90 text-[11px] ps-4">
                          ↳ <span className="font-semibold">{isAr ? 'سبب التحويل:' : 'Failover Reason:'}</span> {log.failoverReason}
                        </div>
                      )}

                      {log.error && (
                        <div className="w-full text-red-300/90 text-[11px] ps-4">
                          ↳ <span className="font-semibold">{isAr ? 'الخطأ:' : 'Error:'}</span> {log.error}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        )}

        {tab === 'storage' && (
          <div className="mx-auto max-w-6xl space-y-6">
            <h2 className="text-sm font-bold text-slate-200">
              {isAr ? 'مراقبة التخزين والبيئة المعزولة (Storage & Isolate Monitor)' : 'Storage & Sandbox Telemetry'}
            </h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center gap-2 text-accent">
                  <Database size={16} />
                  <span className="text-[12.5px] font-bold">{isAr ? 'قاعدة البيانات الأساسية' : 'Database Store'}</span>
                </div>
                <p className="mt-2 text-lg font-bold text-text">{storage?.store.kind.toUpperCase()}</p>
                <p className="mt-1 text-[11.5px] text-dim">{storage?.store.detail}</p>
              </div>

              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center gap-2 text-amber-400">
                  <Server size={16} />
                  <span className="text-[12.5px] font-bold">{isAr ? 'مستودع المرفقات والملفات' : 'Blob Storage'}</span>
                </div>
                <p className="mt-2 text-lg font-bold text-text">{storage?.blob.kind.toUpperCase()}</p>
                <p className="mt-1 text-[11.5px] text-dim">{storage?.blob.detail}</p>
              </div>

              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <TerminalSquare size={16} />
                  <span className="text-[12.5px] font-bold">{isAr ? 'البيئة المعزولة (Sandbox)' : 'Sandbox Isolate'}</span>
                </div>
                <p className="mt-2 text-lg font-bold text-text">{storage?.sandbox.kind.toUpperCase()}</p>
                <p className="mt-1 text-[11.5px] text-dim">{storage?.sandbox.detail}</p>
              </div>
            </div>

            {/* Token Analytics Card */}
            <div className="rounded-xl border border-line bg-surface p-5">
              <h3 className="text-[13px] font-bold text-text mb-3">
                {isAr ? 'إحصائيات استهلاك التوكنز والطلبات (Token Telemetry)' : 'Token & Request Consumption'}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-line/60 bg-[#0c101a] p-3 text-center">
                  <p className="text-[11px] text-dim">{isAr ? 'إجمالي الطلبات' : 'Total Calls'}</p>
                  <p className="mt-1 font-mono text-xl font-bold text-emerald-400">
                    {storage?.usage.totalCalls ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-line/60 bg-[#0c101a] p-3 text-center">
                  <p className="text-[11px] text-dim">{isAr ? 'توكنز الإدخال (Tokens In)' : 'Tokens In'}</p>
                  <p className="mt-1 font-mono text-xl font-bold text-accent">
                    {storage?.usage.tokensIn.toLocaleString() ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-line/60 bg-[#0c101a] p-3 text-center">
                  <p className="text-[11px] text-dim">{isAr ? 'توكنز الإخراج (Tokens Out)' : 'Tokens Out'}</p>
                  <p className="mt-1 font-mono text-xl font-bold text-amber-400">
                    {storage?.usage.tokensOut.toLocaleString() ?? 0}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'brain' && (
          <div className="mx-auto max-w-6xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-200">
                  {isAr ? 'التحكم في عقل نوفا وموجّه النظام الماستر (Master System Prompt)' : 'Master System Prompt & Brain Control'}
                </h2>
                <p className="text-[11.5px] text-dim">
                  {isAr
                    ? 'عدّل شخصية نوفا، أسلوب التفكير العميق (Claude-Style Reasoning)، والافتراضيات فوراً دون إعادة نشر الكود.'
                    : 'Tweak Nova cognitive reasoning persona and default routing live without redeploying code.'}
                </p>
              </div>

              <Button
                variant="primary"
                size="sm"
                icon={<Check size={13} />}
                loading={savingBrain}
                onClick={handleSaveBrain}
              >
                {isAr ? 'حفظ التعديلات في السحابة' : 'Save Brain Updates'}
              </Button>
            </div>

            {/* Model Defaults Selector */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-xl border border-line bg-surface p-4">
              <Field label={isAr ? 'نموذج المحادثة الافتراضي (Chat Class)' : 'Default Chat Model'}>
                <TextInput
                  value={defaultChatModel}
                  onChange={(e) => setDefaultChatModel(e.target.value)}
                  placeholder="Auto (openrouter/deepseek/deepseek-r1:free / qwen)"
                  dir="ltr"
                  className="font-mono text-[12px]"
                />
              </Field>
              <Field label={isAr ? 'نموذج البرمجة الافتراضي (Coding Class)' : 'Default Coding Model'}>
                <TextInput
                  value={defaultCodingModel}
                  onChange={(e) => setDefaultCodingModel(e.target.value)}
                  placeholder="Auto (openrouter/qwen/qwen-2.5-coder-32b-instruct:free)"
                  dir="ltr"
                  className="font-mono text-[12px]"
                />
              </Field>
            </div>

            {/* Master System Prompt Editor */}
            <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-text">
                  {isAr ? 'موجّه النظام الماستر الحاكم (Live Master System Prompt)' : 'Live Master System Prompt'}
                </span>
                <span className="font-mono text-[11px] text-dim">
                  {masterPrompt.length} {isAr ? 'حرف' : 'chars'}
                </span>
              </div>

              <TextArea
                rows={12}
                value={masterPrompt}
                onChange={(e) => setMasterPrompt(e.target.value)}
                placeholder={
                  isAr
                    ? 'اكتب توجيهات النظام الماستر هنا... سيتم حقنها في رأس كل محادثة تلقائياً.'
                    : 'Enter custom master instructions for Nova AI...'
                }
                dir="auto"
                className="font-mono text-[12px] leading-relaxed"
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StudioTabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all',
        active
          ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
          : 'text-dim hover:bg-surface hover:text-text',
      )}
    >
      {icon}
      <span>{label}</span>
      {typeof badge === 'number' && badge > 0 ? (
        <span className="rounded-full bg-amber-500/30 px-1.5 py-0.2 font-mono text-[10px] text-amber-200">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
  tone: 'success' | 'warning' | 'neutral';
}) {
  return (
    <div className="rounded-xl border border-line bg-[#0e1422] p-3.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-dim font-medium">{title}</span>
        {icon}
      </div>
      <p
        className={cn(
          'mt-2 font-mono text-xl font-bold',
          tone === 'success' ? 'text-emerald-400' : tone === 'warning' ? 'text-amber-400' : 'text-text',
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate font-mono text-[10.5px] text-dim">{subtitle}</p>
    </div>
  );
}
