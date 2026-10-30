import { useEffect, useMemo, useState } from 'react';
import type { ChatMessage } from '@nova/shared';
import {
  AlertTriangle, ArrowDown, Brain, FolderKanban, Lightbulb, Link2, MessageSquare, Pencil,
  Sparkles, Trash2, Unlink, X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { api, describeApiError } from '@/lib/api';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { useCodeStore } from '@/store/code';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { Composer } from '@/components/chat/Composer';
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
  const regenerate = useChatStore((s) => s.regenerate);
  const patchConversation = useChatStore((s) => s.patchConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const loadConversations = useChatStore((s) => s.loadConversations);

  const projects = useCodeStore((s) => s.projects);
  const loadProjects = useCodeStore((s) => s.loadProjects);
  const setView = useAppStore((s) => s.setView);
  const selectProject = useCodeStore((s) => s.selectProject);
  const health = useAppStore((s) => s.health);
  const openSettings = useAppStore((s) => s.openSettings);

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
  const showStreaming = streaming.active || (streaming.text.length > 0 && streaming.messageId !== null);

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
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-4 backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {renaming ? (
            <TextInput
              autoFocus
              value={renameValue}
              className="!max-w-xs !py-1"
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
            <>
              <h1 className="max-w-[46ch] truncate text-[13.5px] font-medium">
                {conversation?.title || t('nav.newChat')}
              </h1>
              {activeId && !activeId.startsWith('conv_local') ? (
                <IconButton
                  label={t('common.rename')}
                  className="!px-1.5 !py-1.5"
                  onClick={() => {
                    setRenameValue(conversation?.title ?? '');
                    setRenaming(true);
                  }}
                >
                  <Pencil size={12} />
                </IconButton>
              ) : null}
            </>
          )}
          {conversation?.updatedAt ? (
            <span className="hidden text-[11px] text-dim md:inline">{relativeTime(conversation.updatedAt, locale)}</span>
          ) : null}
        </div>

        {/* project link */}
        <Dropdown
          width={280}
          align="end"
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={toggle}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11.5px] transition-colors',
                project ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line-strong bg-elevated text-muted hover:text-text',
                open && 'border-accent/50',
              )}
              title={t('chat.linkProject')}
            >
              {project ? <FolderKanban size={12} /> : <Link2 size={12} />}
              <span className="max-w-[130px] truncate">{project ? project.name : t('chat.linkProject')}</span>
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
      </header>

      {/* --------------------------------------------------------- banner */}
      {!callable ? (
        <div className="flex items-center gap-2 border-b border-warning/25 bg-warning/8 px-4 py-2">
          <AlertTriangle size={14} className="shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-[12px] text-warning">{t('chat.providerIssue')}</p>
          <Button size="sm" variant="outline" onClick={() => openSettings(true)}>
            {t('settings.providers')}
          </Button>
        </div>
      ) : null}

      {streaming.error ? (
        <div className="flex items-center gap-2 border-b border-danger/25 bg-danger/8 px-4 py-2">
          <AlertTriangle size={14} className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 truncate text-[12px] text-danger">
            {streaming.error === 'network' ? t('error.network') : streaming.error}
          </p>
          <Button size="sm" variant="ghost" onClick={() => openSettings(true)}>
            {t('nav.health')}
          </Button>
        </div>
      ) : null}

      {/* -------------------------------------------------------- messages */}
      <div ref={ref} onScroll={onScroll} className="scroll-thin relative min-h-0 flex-1">
        {list.length === 0 && !showStreaming ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6 py-10">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
              <Sparkles size={22} />
            </div>
            <h2 className="text-center text-[19px] font-semibold tracking-tight">{t('chat.emptyTitle')}</h2>
            <p className="mt-1.5 max-w-md text-center text-[12.5px] leading-relaxed text-dim">{t('chat.emptyHint')}</p>
            <div className="mt-6 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s, projectId)}
                  className="card-hover flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2.5 text-start text-[12.5px] text-muted"
                >
                  <Lightbulb size={13} className="shrink-0 text-accent" />
                  <span className="min-w-0">{s}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
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
