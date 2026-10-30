import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Square, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { estimateTokens, type ModelClass } from '@nova/shared';
import { formatNumber } from '@/lib/format';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { ModelPicker } from './ModelPicker';
import { IconButton, Spinner } from '@/components/ui';

const MAX_UPLOAD = 8 * 1024 * 1024;

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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-grow up to ~9 lines, then scroll inside.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || streaming) return;
    void send(text, projectId ?? null);
    setValue('');
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD) {
        toast({ kind: 'error', message: file.name, hint: t('chat.tooLarge', { size: '8MB' }) });
        continue;
      }
      await addAttachment(file, projectId ?? null);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const tokens = estimateTokens(value);

  return (
    <div className="px-4 pb-4">
      <div className="mx-auto w-full max-w-3xl">
        {composer.attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {composer.attachments.map((a) => (
              <span key={a.id} className="chip !py-1 ps-2">
                <Paperclip size={11} className="text-dim" />
                <span className="max-w-[200px] truncate">{a.name}</span>
                <span className="text-dim">{formatNumber(a.size)}B</span>
                {a.extractedChars === 0 ? (
                  <span className="text-warning" title={t('chat.binarySkipped')}>•</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="text-dim transition-colors hover:text-danger"
                  aria-label={t('chat.removeAttachment')}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            'rounded-xl border bg-panel transition-colors',
            streaming ? 'border-accent/45' : 'border-line-strong focus-within:border-accent/55',
          )}
        >
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            disabled={streaming}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={projectId ? t('chat.placeholderWithProject') : t('chat.placeholder')}
            className="max-h-[220px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13.5px] leading-relaxed text-text outline-none placeholder:text-dim disabled:opacity-60"
          />

          <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
            <input
              ref={fileRef}
              type="file"
              multiple
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
                  disabled={!value.trim()}
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
