import { useEffect, useRef, useState } from 'react';
import { Film, Globe, Image as ImageIcon, MessageSquare, Paperclip, Send, Square, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { estimateTokens, type ModelClass, type StudioMode } from '@nova/shared';
import { formatNumber } from '@/lib/format';
import { authMediaUrl, isImageMime, isVideoMime } from '@/lib/media';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { ModelPicker } from './ModelPicker';
import { IconButton, Spinner } from '@/components/ui';

const MAX_UPLOAD = 25 * 1024 * 1024;

export function Composer({ projectId, onNeedProject }: { projectId?: string | null; onNeedProject?: () => void }) {
  const { t } = useI18n();
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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-grow up to ~9 lines, then scroll inside.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const canSend = (value.trim().length > 0 || composer.attachments.length > 0) && !streaming && !composer.uploading;

  const submit = () => {
    if (!canSend) return;
    void send(value.trim(), projectId ?? null);
    setValue('');
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
      : composer.studioMode === 'video'
        ? t('studio.placeholder.video')
        : composer.studioMode === 'website'
          ? t('studio.placeholder.website')
          : projectId
            ? t('chat.placeholderWithProject')
            : t('chat.placeholder');

  const modes: { id: StudioMode; label: string; icon: React.ReactNode }[] = [
    { id: 'chat', label: t('studio.mode.chat'), icon: <MessageSquare size={12} /> },
    { id: 'image', label: t('studio.mode.image'), icon: <ImageIcon size={12} /> },
    { id: 'video', label: t('studio.mode.video'), icon: <Film size={12} /> },
    { id: 'website', label: t('studio.mode.website'), icon: <Globe size={12} /> },
  ];

  const visibleAttachments = composer.attachments.filter((a) => !/-frame-\d+\.jpg$/i.test(a.name));
  const tokens = estimateTokens(value);

  return (
    <div className="px-4 pb-4">
      <div className="mx-auto w-full max-w-3xl">
        {/* Studio Mode Bar */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
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
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
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
            'rounded-xl border bg-panel transition-colors',
            dragging
              ? 'border-accent bg-accent/5'
              : streaming
                ? 'border-accent/45'
                : 'border-line-strong focus-within:border-accent/55',
          )}
        >
          <textarea
            ref={taRef}
            rows={1}
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
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={dragging ? t('studio.dropHint') : placeholder}
            className="max-h-[220px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13.5px] leading-relaxed text-text outline-none placeholder:text-dim disabled:opacity-60"
          />

          <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
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
              onClick={() => (projectId ? fileRef.current?.click() : (onNeedProject?.(), fileRef.current?.click()))}
              disabled={composer.uploading}
            >
              {composer.uploading ? <Spinner size={14} /> : <Paperclip size={15} />}
            </IconButton>

            <ModelPicker
              value={composer.modelId}
              onChange={(modelId) => setComposer({ modelId })}
              modelClass={composer.modelClass}
              onClassChange={(c: ModelClass) => setComposer({ modelClass: c })}
              compact
            />

            <div className="ms-auto flex items-center gap-2">
              {tokens > 0 ? (
                <span className="hidden font-mono text-[10.5px] text-dim sm:inline">~{formatNumber(tokens)} tok</span>
              ) : null}
              {streaming ? (
                <button type="button" onClick={stop} className="btn btn-outline !border-danger/40 !text-danger">
                  <Square size={12} />
                  {t('chat.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  className="btn btn-primary"
                  title="Enter"
                >
                  <Send size={13} />
                  {t('chat.send')}
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-1.5 px-1 text-[10.5px] leading-relaxed text-dim">
          {t('chat.keys')}
          {!projectId ? ` · ${t('chat.noProject')}` : ''}
        </p>
      </div>
    </div>
  );
}
