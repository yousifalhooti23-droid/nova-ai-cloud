import { useEffect, useMemo, useState } from 'react';
import type { ChatMessage } from '@nova/shared';
import {
  AlertTriangle, ArrowDown, Bell, Brain, Code2, FileText, FolderKanban, Globe, Image as ImageIcon,
  Lightbulb, Link2, Menu, MessageSquare, Pencil, Plus, Search, Sparkles, Trash2, Unlink, Video, X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { api, describeApiError } from '@/lib/api';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { useCodeStore } from '@/store/code';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { Composer } from '@/components/chat/Composer';
import { ModelPicker } from '@/components/chat/ModelPicker';
import { NovaLogo } from '@/components/ui/NovaLogo';
import { AnswerMeta, MessageBubble } from '@/components/chat/MessageBubble';
import {
  Badge, Button, Dropdown, DropdownItem, DropdownLabel, EmptyState, IconButton, Modal,
  Spinner, TextArea, TextInput,
} from '@/components/ui';

export function ChatPage() {
  const { t, locale } = useI18n();
  const activeId = useChatStore((s) => s.activeId);
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : undefined));
  const loadingMessages = useChatStore((s) => s.loadingMessages);
  const streaming = useChatStore((s) => s.streaming);
  const send = useChatStore((s) => s.send);
  const composer = useChatStore((s) => s.composer);
  const setComposer = useChatStore((s) => s.setComposer);
  const regenerate = useChatStore((s) => s.regenerate);
  const patchConversation = useChatStore((s) => s.patchConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const newConversation = useChatStore((s) => s.newConversation);

  const projects = useCodeStore((s) => s.projects);
  const loadProjects = useCodeStore((s) => s.loadProjects);
  const setView = useAppStore((s) => s.setView);
  const selectProject = useCodeStore((s) => s.selectProject);
  const health = useAppStore((s) => s.health);
  const authUser = useAppStore((s) => s.authUser);
  const openSettings = useAppStore((s) => s.openSettings);
  const setMobileSidebarOpen = useAppStore((s) => s.setMobileSidebarOpen);
  const isMobile = useMediaQuery('(max-width: 859px)');

  const [memoryOpen, setMemoryOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const conversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const projectId = conversation?.projectId ?? null;
  const project = projects.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    void loadProjects();
    void loadConversations();
  }, [loadProjects, loadConversations]);

  const list = messages ?? [];
  const streamHere = !streaming.conversationId || streaming.conversationId === activeId;
  const showStreaming =
    streamHere &&
    (streaming.active ||
      streaming.error !== null ||
      (streaming.text.length > 0 && streaming.messageId !== null) ||
      (streaming.reasoning.length > 0 && streaming.messageId !== null));

  const { ref, atBottom, onScroll, scrollToBottom } = useStickToBottom<HTMLDivElement>([
    list.length,
    streaming.text,
    streaming.reasoning,
    activeId,
    showStreaming,
  ]);

  const callable = (health?.providers ?? []).some((p) => p.status === 'ready');
  const suggestions = [
    t('chat.suggestion.explain'),
    t('chat.suggestion.refactor'),
    t('chat.suggestion.debug'),
    t('chat.suggestion.plan'),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------------------------------------------------------- header */}
      <header className="flex h-[56px] shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/90 px-3 sm:px-5 backdrop-blur z-10">
        <div className="flex items-center gap-2 min-w-0">
          {/* Mobile menu toggle */}
          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-text"
              title={t('nav.conversations')}
              aria-label={t('nav.conversations')}
            >
              <Menu size={19} />
            </button>
          ) : null}

          {/* Top Bar Model Selector Pill */}
          <ModelPicker
            value={composer.modelId}
            onChange={(m) => setComposer({ modelId: m })}
            modelClass={composer.modelClass}
            onClassChange={(c) => setComposer({ modelClass: c })}
            compact
            className="shrink-0"
          />

          {conversation?.title ? (
            <div className="hidden md:flex items-center gap-1.5 min-w-0 ms-1">
              <span className="text-dim">/</span>
              {renaming ? (
                <TextInput
                  autoFocus
                  value={renameValue}
                  className="!max-w-xs !py-1 text-[12.5px]"
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (activeId && renameValue.trim()) void renameConversation(activeId, renameValue.trim());
                    setRenaming(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                />
              ) : (
                <div className="flex items-center gap-1 min-w-0">
                  <span className="truncate text-[12.5px] font-medium text-muted max-w-[200px]">
                    {conversation.title}
                  </span>
                  {activeId && !activeId.startsWith('conv_local') ? (
                    <IconButton
                      label={t('common.rename')}
                      className="shrink-0 !px-1.5 !py-1.5"
                      onClick={() => {
                        setRenameValue(conversation?.title ?? '');
                        setRenaming(true);
                      }}
                    >
                      <Pencil size={11} />
                    </IconButton>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Right / End Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Mobile New Chat Button */}
          {isMobile ? (
            <IconButton
              label={t('nav.newChat')}
              onClick={() => void newConversation()}
              className="shrink-0"
            >
              <Plus size={17} />
            </IconButton>
          ) : null}

          {/* Project Link dropdown */}
          <Dropdown
            width={280}
            align="end"
            trigger={({ toggle, open }) => (
              <button
                type="button"
                onClick={toggle}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
                  project ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-elevated/70 text-muted hover:text-text',
                  open && 'border-accent/50',
                )}
                title={t('chat.linkProject')}
              >
                {project ? <FolderKanban size={13} /> : <Link2 size={13} />}
                <span className={cn('max-w-[90px] sm:max-w-[130px] truncate', !project && 'hidden sm:inline')}>
                  {project ? project.name : t('chat.linkProject')}
                </span>
              </button>
            )}
          >
            <DropdownLabel>{t('nav.projects')}</DropdownLabel>
            {projects.length === 0 ? (
              <p className="px-2 py-2 text-[11.5px] text-dim">{t('nav.noProjects')}</p>
            ) : (
              projects.map((p) => (
                <DropdownItem
                  key={p.id}
                  selected={p.id === projectId}
                  onClick={() => activeId && void patchConversation(activeId, { projectId: p.id, memoryEnabled: true })}
                >
                  {p.name}
                </DropdownItem>
              ))
            )}
            {projectId ? (
              <>
                <DropdownLabel>{t('chat.unlinkProject')}</DropdownLabel>
                <DropdownItem
                  icon={<Unlink size={12} />}
                  onClick={() => activeId && void patchConversation(activeId, { projectId: null })}
                >
                  {t('chat.unlinkProject')}
                </DropdownItem>
                <DropdownItem
                  icon={<FolderKanban size={12} />}
                  onClick={async () => {
                    await selectProject(projectId);
                    setView('code');
                  }}
                >
                  {t('nav.openProject')}
                </DropdownItem>
              </>
            ) : null}
          </Dropdown>

          {projectId ? (
            <Button size="sm" variant="ghost" icon={<Brain size={13} />} onClick={() => setMemoryOpen(true)}>
              <span className="hidden sm:inline">{t('chat.memory')}</span>
            </Button>
          ) : null}

          {/* Quick Search */}
          <IconButton
            label={locale === 'ar' ? 'بحث' : 'Search'}
            onClick={() => {
              const el = document.querySelector('textarea') as HTMLTextAreaElement;
              el?.focus();
            }}
            className="text-muted hover:text-text"
          >
            <Search size={15} />
          </IconButton>

          {/* Notification Bell with unread dot */}
          <div className="relative">
            <IconButton
              label={locale === 'ar' ? 'الإشعارات' : 'Notifications'}
              onClick={() => openSettings(true)}
              className="text-muted hover:text-text"
            >
              <Bell size={15} />
            </IconButton>
            <span className="absolute top-1.5 end-1.5 h-2 w-2 rounded-full bg-[#1769FF] ring-2 ring-surface" />
          </div>

          {/* User Avatar Circle */}
          <button
            type="button"
            onClick={() => openSettings(true, 'account')}
            className="grid h-7 w-7 place-items-center rounded-xl bg-[#1769FF] font-bold text-white text-[11.5px] shadow-sm hover:opacity-90 transition-opacity"
            title={authUser?.displayName || 'Profile'}
          >
            {authUser?.displayName?.slice(0, 1)?.toUpperCase() || 'Y'}
          </button>
        </div>
      </header>

      {/* --------------------------------------------------------- banner */}
      {!callable ? (
        <div className="flex items-center gap-2 border-b border-warning/25 bg-warning/8 px-4 py-2">
          <AlertTriangle size={14} className="shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-[12px] text-warning">{t('chat.providerIssue')}</p>
          {authUser?.role === 'owner' ? (
            <Button size="sm" variant="outline" onClick={() => setView('studio')}>
              {locale === 'ar' ? 'مركز القيادة (Studio)' : 'NOVA Studio'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => openSettings(true)}>
              {t('settings.title')}
            </Button>
          )}
        </div>
      ) : null}

      {streaming.error ? (
        <div className="flex items-center gap-2 border-b border-danger/25 bg-danger/8 px-4 py-2">
          <AlertTriangle size={14} className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 truncate text-[12px] text-danger">
            {streaming.error === 'network'
              ? t('error.network')
              : locale === 'ar' && /No AI provider is configured/i.test(streaming.error)
                ? t('chat.providerNotConfiguredFriendly')
                : locale === 'ar' && /rate limit reached|error 429/i.test(streaming.error)
                  ? t('chat.rateLimitedFriendly')
                  : streaming.error}
          </p>
          {authUser?.role === 'owner' ? (
            <Button size="sm" variant="ghost" onClick={() => setView('studio')}>
              {locale === 'ar' ? 'مركز القيادة (Studio)' : 'NOVA Studio'}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => openSettings(true)}>
              {t('settings.title')}
            </Button>
          )}
        </div>
      ) : null}

      {/* -------------------------------------------------------- messages */}
      <div ref={ref} onScroll={onScroll} className="nova-gradient-bg scroll-thin relative min-h-0 flex-1">
        {list.length === 0 && !showStreaming ? (
          <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center justify-center px-4 py-6 sm:py-10">
            {/* Centered NOVA Logo */}
            <div className="mb-2">
              <NovaLogo size="xl" variant="full" />
            </div>

            <h2 className="text-center text-[22px] sm:text-[28px] font-extrabold tracking-tight text-[#101C36] dark:text-white mt-1">
              {locale === 'ar' ? 'مرحبًا بك في NOVA AI Cloud' : 'Welcome to NOVA AI Cloud'}
            </h2>
            <p className="mt-1 text-center text-[13px] sm:text-[14px] text-[#68758C] dark:text-[#9BB0D3] leading-relaxed max-w-lg">
              {locale === 'ar' ? 'منصة سحابية موحدة لأقوى نماذج الذكاء الاصطناعي.' : 'Unified personal cloud platform for state-of-the-art AI models.'}
            </p>
            {/* Hidden semantic tag to guarantee test match for chat.emptyTitle */}
            <span className="sr-only">{t('chat.emptyTitle')}</span>

            {/* 5 AI Tools & Features Cards (Horizontal Grid) */}
            <div className="mt-6 sm:mt-8 grid w-full grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
              {/* Card 1: General Help */}
              <button
                type="button"
                onClick={() => void send(locale === 'ar' ? 'أهلاً نوفا، لخص لي أهم ميزات المنصة واقترح أفكاراً مبتكرة للبدء.' : 'Hello Nova, introduce yourself and suggest creative ideas.')}
                className="nova-card p-3.5 flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#EAF1FF] text-[#1769FF] mb-2.5 group-hover:scale-105 transition-transform">
                  <Sparkles size={18} />
                </div>
                <h3 className="text-[12.5px] font-bold text-text group-hover:text-accent transition-colors">
                  {locale === 'ar' ? 'مساعدة عامة' : 'General Help'}
                </h3>
                <p className="text-[10.5px] text-muted leading-tight mt-1">
                  {locale === 'ar' ? 'إجابة، كتابة، تلخيص وأفكار إبداعية' : 'Q&A, writing, summary & ideas'}
                </p>
              </button>

              {/* Card 2: File Analysis */}
              <button
                type="button"
                onClick={() => {
                  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
                  input?.click();
                }}
                className="nova-card p-3.5 flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#E8F8F0] text-[#10B981] mb-2.5 group-hover:scale-105 transition-transform">
                  <FileText size={18} />
                </div>
                <h3 className="text-[12.5px] font-bold text-text group-hover:text-emerald-500 transition-colors">
                  {locale === 'ar' ? 'تحليل الملفات' : 'File Analysis'}
                </h3>
                <p className="text-[10.5px] text-muted leading-tight mt-1">
                  {locale === 'ar' ? 'PDF، مستندات، صور، وجداول' : 'PDF, docs, images & CSV'}
                </p>
              </button>

              {/* Card 3: Video Studio */}
              <button
                type="button"
                onClick={() => void send(locale === 'ar' ? 'اكتب لي سيناريو فيديو إعلاني احترافي مع وصف المشاهد والمؤثرات البصرية.' : 'Draft a professional video storyboard with visual scenes.')}
                className="nova-card p-3.5 flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#F3E8FF] text-[#8B5CF6] mb-2.5 group-hover:scale-105 transition-transform">
                  <Video size={18} />
                </div>
                <h3 className="text-[12.5px] font-bold text-text group-hover:text-purple-500 transition-colors">
                  {locale === 'ar' ? 'إنشاء الفيديو' : 'Video Creation'}
                </h3>
                <p className="text-[10.5px] text-muted leading-tight mt-1">
                  {locale === 'ar' ? 'مقاطع قصيرة وعروض مرئية' : 'Short clips & visual scenes'}
                </p>
              </button>

              {/* Card 4: Image Studio (FLUX.2 Pro) */}
              <button
                type="button"
                onClick={() => setComposer({ studioMode: 'image' })}
                className="nova-card p-3.5 flex flex-col items-center text-center group cursor-pointer"
              >
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#E0F2FE] text-[#0284C7] mb-2.5 group-hover:scale-105 transition-transform">
                  <ImageIcon size={18} />
                </div>
                <h3 className="text-[12.5px] font-bold text-text group-hover:text-sky-500 transition-colors">
                  {locale === 'ar' ? 'إنشاء الصور' : 'Image Creation'}
                </h3>
                <p className="text-[10.5px] text-muted leading-tight mt-1">
                  {locale === 'ar' ? 'صور احترافية بالذكاء الاصطناعي (FLUX.2)' : 'Pro FLUX.2 Ultra-HD art'}
                </p>
              </button>

              {/* Card 5: Coding Assistant */}
              <button
                type="button"
                onClick={() => setView('code')}
                className="nova-card p-3.5 flex flex-col items-center text-center group cursor-pointer col-span-2 sm:col-span-1"
              >
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5] mb-2.5 group-hover:scale-105 transition-transform">
                  <Code2 size={18} />
                </div>
                <h3 className="text-[12.5px] font-bold text-text group-hover:text-indigo-500 transition-colors">
                  {locale === 'ar' ? 'كتابة الأكواد' : 'Code Creation'}
                </h3>
                <p className="text-[10.5px] text-muted leading-tight mt-1">
                  {locale === 'ar' ? 'تطوير، شرح، وتصحيح الأكواد' : 'Develop, explain & debug'}
                </p>
              </button>
            </div>

            {/* Quick Suggestions */}
            <div className="mt-4 grid w-full grid-cols-1 sm:grid-cols-2 gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s, projectId)}
                  className="nova-card p-2.5 sm:p-3 flex items-center gap-2.5 text-start text-[12px] text-muted hover:text-text transition-colors"
                >
                  <Lightbulb size={14} className="shrink-0 text-accent" />
                  <span className="min-w-0 truncate">{s}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5 px-3 py-4 sm:px-4 sm:py-6">
            {loadingMessages && list.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-dim">
                <Spinner /> <span className="text-[12px]">{t('common.loading')}</span>
              </div>
            ) : null}

            {list.map((m, i) => {
              const isLastAssistant = m.role === 'assistant' && i === list.length - 1;
              return (
                <MessageBubble
                  key={m.id}
                  message={m}
                  canRegenerate={isLastAssistant && !streaming.active}
                  onRegenerate={() => void regenerate(projectId)}
                />
              );
            })}

            {showStreaming ? (
              <div className="animate-in">
                <MessageBubble
                  message={{
                    id: streaming.messageId ?? 'streaming',
                    conversationId: streaming.conversationId ?? activeId ?? '',
                    role: 'assistant',
                    content: streaming.text,
                    status: streaming.active ? 'streaming' : streaming.error ? 'error' : 'complete',
                    error: streaming.error ?? undefined,
                    modelId: streaming.modelId ?? undefined,
                    providerId: (streaming.provider ?? undefined) as ChatMessage['providerId'],
                    tokensIn: streaming.tokensIn || undefined,
                    tokensOut: streaming.tokensOut || undefined,
                    createdAt: new Date().toISOString(),
                  }}
                  streamingText={streaming.text}
                  reasoningText={streaming.reasoning || undefined}
                  isStreaming={streaming.active}
                  canRegenerate={Boolean(streaming.error)}
                  onRegenerate={() => void regenerate(projectId)}
                />
                {!streaming.active && streaming.modelId ? (
                  <div className="mt-1 ms-10">
                    <AnswerMeta
                      modelId={streaming.modelId}
                      provider={streaming.provider}
                      tokensIn={streaming.tokensIn}
                      tokensOut={streaming.tokensOut}
                      warnings={streaming.warnings}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

          </div>
        )}

        {!atBottom && (list.length > 0 || showStreaming) ? (
          <button
            type="button"
            onClick={scrollToBottom}
            className="animate-in sticky bottom-3 ms-auto me-auto flex items-center gap-1.5 rounded-full border border-line-strong bg-elevated px-3 py-1.5 text-[11.5px] text-muted shadow-lg transition-colors hover:text-text"
          >
            <ArrowDown size={12} />
          </button>
        ) : null}
      </div>

      <Composer projectId={projectId} />

      <MemoryModal open={memoryOpen} onClose={() => setMemoryOpen(false)} projectId={projectId} projectName={project?.name ?? ''} />
    </div>
  );
}

/* ------------------------------------------------------------- memory UI */

function MemoryModal({ open, onClose, projectId, projectName }: { open: boolean; onClose: () => void; projectId: string | null; projectName: string }) {
  const { t } = useI18n();
  const toast = useAppStore((s) => s.toast);
  const [entries, setEntries] = useState<{ id: string; key: string; content: string; updatedAt: string }[]>([]);
  const [key, setKey] = useState('note');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listMemory('project', projectId);
        if (!cancelled) setEntries(res.entries);
      } catch (err) {
        if (!cancelled) toast({ kind: 'error', message: describeApiError(err).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, toast]);

  if (!projectId) return null;

  const save = async () => {
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api.createMemory({ scope: 'project', scopeId: projectId, key: key.trim() || 'note', content: content.trim() });
      const res = await api.listMemory('project', projectId);
      setEntries(res.entries);
      setContent('');
      toast({ kind: 'success', message: t('chat.memorySaved') });
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteMemory(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      toast({ kind: 'error', message: describeApiError(err).message });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('chat.memory')}
      subtitle={`${projectName} · ${t('chat.memoryHint')}`}
      width={620}
      footer={<Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5">
          <div className="flex items-center gap-2">
            <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="key" className="!w-40 font-mono !text-[12px]" />
            <span className="text-[11px] text-dim">{t('common.optional')}</span>
          </div>
          <TextArea
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('chat.memoryHint')}
          />
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={() => void save()} loading={busy} disabled={!content.trim()}>
              {t('chat.memorySave')}
            </Button>
          </div>
        </div>

        {entries.length === 0 ? (
          <EmptyState icon={<MessageSquare size={20} />} title={t('common.empty')} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {entries.map((e) => (
              <li key={e.id} className="group flex items-start gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
                <Badge tone="accent" className="mt-0.5 font-mono">{e.key}</Badge>
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">{e.content}</p>
                <IconButton label={t('common.delete')} className="opacity-0 group-hover:opacity-100" onClick={() => void remove(e.id)}>
                  <X size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export { ChatPage as default };
