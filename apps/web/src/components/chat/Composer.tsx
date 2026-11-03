import { useEffect, useRef, useState } from 'react';
import { Globe, Image as ImageIcon, MessageSquare, Paperclip, Puzzle, Send, Square, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { estimateTokens, type ModelClass, type StudioMode } from '@nova/shared';
import { formatNumber } from '@/lib/format';
import { authMediaUrl, isImageMime, isVideoMime } from '@/lib/media';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { IconButton, Spinner } from '@/components/ui';
import { SkillsModal } from '../skills/SkillsModal';

const MAX_UPLOAD = 25 * 1024 * 1024;

export function Composer({ projectId, onNeedProject }: { projectId?: string | null; onNeedProject?: () => void }) {
  const { t, locale } = useI18n();
  const composer = useChatStore((s) => s.composer);
  const setComposer = useChatStore((s) => s.setComposer);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const streaming = useChatStore((s) => s.streaming.active);
  const addAttachment = useChatStore((s) => s.addAttachment);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const toast = useAppStore((s) => s.toast);

  const [value, setValue] = useState('');
  const [dragging, setDragging] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleSkill = (id: string) => {
    const current = composer.activeSkills ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setComposer({ activeSkills: next });
  };

  // Auto-grow up to ~9 lines, then scroll inside.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const canSend = (value.trim().length > 0 || composer.attachments.length > 0) && !streaming && !composer.uploading;

  const submit = () => {
    // Read the DOM value: on iOS/Android predictive keyboards React state can lag
    // the textarea by the last (still-composing) word.
    const text = (taRef.current?.value ?? value).trim();
    if (streaming || composer.uploading) return;
    if (!text && composer.attachments.length === 0) return;
    setValue('');
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        taRef.current.blur();
      }
    }
    void send(text, projectId ?? null);
  };

  const onFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    for (const file of list) {
      if (file.size > MAX_UPLOAD) {
        toast({ kind: 'error', message: file.name, hint: t('chat.tooLarge', { size: '25MB' }) });
        continue;
      }
      await addAttachment(file, projectId ?? null);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const placeholder =
    composer.studioMode === 'image'
      ? t('studio.placeholder.image')
      : composer.studioMode === 'website'
        ? t('studio.placeholder.website')
        : projectId
          ? t('chat.placeholderWithProject')
          : (locale === 'ar' ? 'اكتب رسالتك هنا...' : t('chat.placeholder'));

  const modes: { id: StudioMode; label: string; icon: React.ReactNode }[] = [
    { id: 'chat', label: t('studio.mode.chat'), icon: <MessageSquare size={12} /> },
    { id: 'image', label: t('studio.mode.image'), icon: <ImageIcon size={12} /> },
    { id: 'website', label: t('studio.mode.website'), icon: <Globe size={12} /> },
  ];

  const visibleAttachments = composer.attachments.filter((a) => !/-frame-\d+\.jpg$/i.test(a.name));
  const tokens = estimateTokens(value);

  return (
    <div className="pb-safe px-2.5 pt-1 sm:px-4 sm:pb-4">
      <div className="mx-auto w-full max-w-3xl">
        {/* Studio Mode Bar */}
        <div className="mb-1.5 sm:mb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 sm:flex-wrap">
          {modes.map((m) => {
            const active = composer.studioMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setComposer({ studioMode: m.id });
                  taRef.current?.focus();
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:text-[11.5px] transition-colors whitespace-nowrap',
                  active
                    ? 'border-accent/60 bg-accent/15 font-medium text-accent'
                    : 'border-line bg-panel text-muted hover:border-line-strong hover:text-text',
                )}
              >
                {m.icon}
                {m.label}
              </button>
            );
          })}

          {/* Universal Skills & Plugins Hub */}
          <button
            type="button"
            onClick={() => setSkillsOpen(true)}
            title={locale === 'ar' ? 'متجر المهارات والإضافات الذكية: مستكشف GitHub، كانفاس الكود، مخططات المعمارية واستيراد أي مهارة' : 'Skills & MCP Hub: GitHub Explorer, Canvas, Architecture Diagrams, and GitHub skill importer'}
            className={cn(
              'ms-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:text-[11.5px] transition-all whitespace-nowrap',
              composer.activeSkills?.length
                ? 'border-accent/80 bg-accent/20 font-semibold text-accent shadow-[0_0_12px_rgba(56,189,248,0.25)]'
                : 'border-line bg-panel text-muted hover:border-line-strong hover:text-text',
            )}
          >
            <Puzzle size={12} className={cn(Boolean(composer.activeSkills?.length) && 'text-accent')} />
            <span>{locale === 'ar' ? 'المهارات والإضافات' : 'Skills & MCP'}</span>
            {composer.activeSkills?.length ? (
              <span className="rounded-full bg-accent px-1.5 py-0.2 text-[9.5px] font-bold text-black">
                {composer.activeSkills.length}
              </span>
            ) : null}
          </button>

          {/* Manual Web Search Toggle */}
          <button
            type="button"
            onClick={() => {
              setComposer({ webSearch: !composer.webSearch });
              taRef.current?.focus();
            }}
            title={locale === 'ar' ? 'تفعيل البحث الحي في الويب للوصول لأحدث معلومات وتحديثات اللحظة الحالية' : 'Toggle live web search grounding for real-time information'}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:text-[11.5px] transition-all whitespace-nowrap',
              composer.webSearch
                ? 'border-sky-500/80 bg-sky-500/20 font-semibold text-sky-300 shadow-[0_0_12px_rgba(14,165,233,0.3)]'
                : 'border-line bg-panel text-muted hover:border-line-strong hover:text-text',
            )}
          >
            <Globe size={12} className={cn(composer.webSearch && 'text-sky-400')} />
            <span>{locale === 'ar' ? 'بحث في الويب' : 'Web Search'}</span>
            {composer.webSearch ? (
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
            ) : null}
          </button>
        </div>

        {/* Attachment previews (images, videos, text/code) */}
        {visibleAttachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {visibleAttachments.map((a) => {
              const isImg = isImageMime(a.mime, a.name);
              const isVid = isVideoMime(a.mime, a.name);
              const mediaSrc = authMediaUrl(a.url);
              return (
                <div
                  key={a.id}
                  className="relative flex items-center gap-2 rounded-lg border border-line-strong bg-elevated px-2 py-1.5 text-[11.5px]"
                >
                  {isImg && mediaSrc ? (
                    <img src={mediaSrc} alt={a.name} className="h-9 w-9 rounded object-cover" />
                  ) : isVid && mediaSrc ? (
                    <video src={mediaSrc} muted preload="metadata" className="h-9 w-12 rounded bg-black object-cover" />
                  ) : (
                    <Paperclip size={12} className="text-dim" />
                  )}
                  <div className="min-w-0">
                    <div className="max-w-[160px] truncate text-text">{a.name}</div>
                    <div className="text-[10px] text-dim">{formatNumber(a.size)}B</div>
                  </div>
                  {!isImg && !isVid && a.extractedChars === 0 ? (
                    <span className="text-warning" title={t('chat.binarySkipped')}>•</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    className="ms-1 text-dim transition-colors hover:text-danger"
                    aria-label={t('chat.removeAttachment')}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer?.files?.length) void onFiles(e.dataTransfer.files);
          }}
          className={cn(
            'nova-composer-card border transition-all p-3 sm:p-3.5',
            dragging
              ? 'border-accent bg-accent/5'
              : streaming
                ? 'border-accent/45'
                : 'border-line focus-within:border-accent/60',
          )}
        >
          <textarea
            ref={taRef}
            rows={2}
            value={value}
            disabled={streaming}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.some((f) => isImageMime(f.type, f.name) || isVideoMime(f.type, f.name))) {
                e.preventDefault();
                void onFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={dragging ? t('studio.dropHint') : placeholder}
            className="min-h-[48px] max-h-[220px] w-full resize-none bg-transparent px-2.5 pt-1 text-[15px] leading-relaxed text-text outline-none placeholder:text-muted/70 disabled:opacity-60"
          />

          <div className="flex items-center justify-between gap-2 px-1 pt-2 sm:gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,video/*,.txt,.md,.json,.csv,.log,.yml,.yaml,.xml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.cpp,.h,.css,.html,.sh,.sql,.toml"
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
              />
              <IconButton
                label={t('chat.attach')}
                className="shrink-0 text-muted hover:text-text hover:bg-elevated rounded-xl h-8 w-8"
                onClick={() => (projectId ? fileRef.current?.click() : (onNeedProject?.(), fileRef.current?.click()))}
                disabled={composer.uploading}
              >
                {composer.uploading ? <Spinner size={15} /> : <Paperclip size={16} />}
              </IconButton>

              {/* Tools Pill */}
              <button
                type="button"
                onClick={() => setSkillsOpen(true)}
                title={locale === 'ar' ? 'متجر الأدوات والمهارات الذكية' : 'AI Tools & Skills'}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-elevated/80 px-3 py-1 text-[12px] font-medium text-muted hover:text-text hover:border-line-strong hover:bg-elevated transition-colors"
              >
                <Puzzle size={13} className="text-accent" />
                <span>{locale === 'ar' ? 'الأدوات' : 'Tools'}</span>
              </button>

              {/* Web Search Pill */}
              <button
                type="button"
                onClick={() => {
                  setComposer({ webSearch: !composer.webSearch });
                  taRef.current?.focus();
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-all',
                  composer.webSearch
                    ? 'border-sky-500/80 bg-sky-500/15 text-sky-600 dark:text-sky-300 font-semibold shadow-xs'
                    : 'border-line bg-elevated/80 text-muted hover:text-text hover:border-line-strong hover:bg-elevated',
                )}
              >
                <Globe size={13} className={cn(composer.webSearch ? 'text-sky-500' : 'text-muted')} />
                <span>{locale === 'ar' ? 'بحث الويب' : 'Web Search'}</span>
                {composer.webSearch ? <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" /> : null}
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {tokens > 0 ? (
                <span className="hidden font-mono text-[10.5px] text-dim md:inline">~{formatNumber(tokens)} tok</span>
              ) : null}
              {streaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-danger transition-colors hover:bg-danger/20"
                  title={t('chat.stop')}
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    if (canSend) e.preventDefault();
                  }}
                  onClick={submit}
                  disabled={!canSend}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 shadow-md',
                    canSend
                      ? 'bg-[#1769FF] text-white shadow-[0_4px_16px_rgba(23,105,255,0.4)] hover:bg-[#1255D4] hover:shadow-[0_6px_20px_rgba(23,105,255,0.5)] active:scale-95'
                      : 'bg-elevated border border-line text-dim cursor-not-allowed opacity-50',
                  )}
                  title="Enter"
                  aria-label={t('chat.send')}
                >
                  <Send size={15} className="rtl:rotate-180" />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-1.5 hidden px-1 text-[10.5px] leading-relaxed text-dim sm:block">
          {t('chat.keys')}
          {!projectId ? ` · ${t('chat.noProject')}` : ''}
        </p>
      </div>

      <SkillsModal
        open={skillsOpen}
        onClose={() => setSkillsOpen(false)}
        activeSkillIds={composer.activeSkills ?? []}
        onToggleActiveSkill={toggleSkill}
      />
    </div>
  );
}
