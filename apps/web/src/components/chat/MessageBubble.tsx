import { memo, useState } from 'react';
import type { ChatMessage } from '@nova/shared';
import { AlertTriangle, Bot, Check, Copy, KeyRound, Paperclip, RefreshCw, User, Wrench } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatNumber, prettyModelId, providerLabel, relativeTime } from '@/lib/format';
import { authMediaUrl, isImageMime, isVideoMime } from '@/lib/media';
import { useAppStore } from '@/store/app';
import { Markdown } from './Markdown';
import { Badge, Button } from '@/components/ui';

interface Props {
  message: ChatMessage;
  /** Live text while the assistant answer is still streaming. */
  streamingText?: string;
  reasoningText?: string;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  canRegenerate?: boolean;
}

export const MessageBubble = memo(function MessageBubble({
  message, streamingText, reasoningText, isStreaming, onRegenerate, canRegenerate,
}: Props) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const body = isStreaming && streamingText !== undefined ? streamingText : message.content;
  const failed = message.status === 'error';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — the button is a convenience */
    }
  };

  return (
    <div className={cn('group flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <Avatar role={message.role} />

      <div className={cn('flex min-w-0 max-w-[min(760px,88%)] flex-col gap-1', isUser && 'items-end')}>
        <div className={cn('flex items-center gap-2 text-[11px] text-dim', isUser && 'flex-row-reverse')}>
          <span className="font-medium text-muted">
            {isUser ? t('chat.you') : isTool ? t('chat.tool') : t('chat.assistant')}
          </span>
          {!isUser && message.modelId ? (
            <span className="truncate" title={message.modelId}>
              {prettyModelId(message.modelId)}
              {message.providerId ? ` · ${providerLabel(message.providerId)}` : ''}
            </span>
          ) : null}
          <span className="shrink-0">{relativeTime(message.createdAt, locale)}</span>
        </div>

        <div
          className={cn(
            'rounded-xl border px-3.5 py-2.5',
            isUser
              ? 'border-line-strong bg-elevated'
              : failed
                ? 'border-danger/35 bg-[#1d1417]'
                : 'border-line bg-panel',
          )}
        >
          {isTool ? (
            <ToolMessage message={message} />
          ) : failed ? (
            <ErrorMessageContent message={message} />
          ) : (
            <>
              {reasoningText ? (
                <details className="mb-2 rounded-lg border border-line bg-surface/70 px-2.5 py-1.5">
                  <summary className="cursor-pointer select-none text-[11px] text-dim">{t('agent.thought')}</summary>
                  <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{reasoningText}</p>
                </details>
              ) : null}
              {body ? (
                isUser ? (
                  <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{body}</p>
                ) : (
                  <Markdown content={body} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} isStreaming={isStreaming} />
                )
              ) : isStreaming ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-dim">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
                  {t('chat.thinking')}
                </span>
              ) : null}
              {isStreaming && body ? <span className="ms-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 animate-pulse bg-accent/80" /> : null}
            </>
          )}

          {message.attachments?.length ? (
            <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
              <div className="flex flex-wrap gap-2">
                {message.attachments
                  .filter((a) => !/-frame-\d+\.jpg$/i.test(a.name))
                  .map((a) => {
                    const mediaSrc = authMediaUrl(a.url);
                    if (isImageMime(a.mime, a.name) && mediaSrc) {
                      return (
                        <a
                          key={a.id}
                          href={mediaSrc}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-line bg-black/30"
                        >
                          <img src={mediaSrc} alt={a.name} className="max-h-48 max-w-[260px] object-cover" loading="lazy" />
                        </a>
                      );
                    }
                    if (isVideoMime(a.mime, a.name) && mediaSrc) {
                      return (
                        <div key={a.id} className="overflow-hidden rounded-lg border border-line bg-black">
                          <video
                            src={mediaSrc}
                            controls
                            preload="metadata"
                            className="max-h-56 max-w-[320px]"
                          />
                        </div>
                      );
                    }
                    return (
                      <span key={a.id} className="chip !py-1">
                        <Paperclip size={11} />
                        <span className="max-w-[180px] truncate">{a.name}</span>
                        <span className="text-dim">{formatNumber(a.size)}B</span>
                      </span>
                    );
                  })}
              </div>
            </div>
          ) : null}
        </div>

        {!isUser && !isStreaming ? (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-dim transition-colors hover:bg-elevated hover:text-text"
              title={t('chat.copyMessage')}
            >
              {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
            {canRegenerate && onRegenerate && !failed ? (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-dim transition-colors hover:bg-elevated hover:text-text"
              >
                <RefreshCw size={11} />
                {t('chat.regenerate')}
              </button>
            ) : null}
            {message.tokensIn || message.tokensOut ? (
              <span className="px-1 text-[10.5px] text-dim">
                {t('chat.usage', { input: formatNumber(message.tokensIn ?? 0), output: formatNumber(message.tokensOut ?? 0) })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function ErrorMessageContent({ message }: { message: ChatMessage }) {
  const { t, locale } = useI18n();
  const openSettings = useAppStore((s) => s.openSettings);
  const raw = message.error || '';
  const isProviderMissing = /No AI provider is configured/i.test(raw);
  const isRateLimited = /rate limit reached|error 429/i.test(raw);
  const displayError =
    locale === 'ar'
      ? isProviderMissing
        ? t('chat.providerNotConfiguredFriendly')
        : isRateLimited
          ? t('chat.rateLimitedFriendly')
          : raw || t('chat.error')
      : raw || t('chat.error');

  return (
    <div className="flex items-start gap-2">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="whitespace-pre-wrap text-[12.5px] font-medium leading-relaxed text-danger">{displayError}</p>
        {message.content ? (
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{message.content}</p>
        ) : null}
        {isProviderMissing ? (
          <div className="mt-2.5">
            <Button
              size="sm"
              variant="outline"
              icon={<KeyRound size={12} />}
              onClick={() => openSettings(true, 'providers')}
            >
              {t('chat.openProvidersBtn')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Avatar({ role }: { role: ChatMessage['role'] }) {
  const styles =
    role === 'user'
      ? 'bg-info/15 text-info border-info/25'
      : role === 'tool'
        ? 'bg-warning/12 text-warning border-warning/25'
        : 'bg-accent/15 text-accent border-accent/25';
  return (
    <div className={cn('mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border', styles)}>
      {role === 'user' ? <User size={14} /> : role === 'tool' ? <Wrench size={13} /> : <Bot size={14} />}
    </div>
  );
}

function ToolMessage({ message }: { message: ChatMessage }) {
  const calls = message.toolCalls ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      {message.content ? <p className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-muted">{message.content}</p> : null}
      {calls.map((c, i) => (
        <div key={c.id ?? i} className="rounded-lg border border-line bg-surface px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Wrench size={11} className="text-warning" />
            <span className="font-mono text-[11.5px] text-text">{c.name}</span>
          </div>
          <pre className="scroll-thin mt-1 max-h-24 overflow-auto font-mono text-[11px] leading-relaxed text-dim" dir="ltr">
            {JSON.stringify(c.arguments ?? {}, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** Compact "answered by" strip shown under a streamed reply. */
export function AnswerMeta({ modelId, provider, tokensIn, tokensOut, warnings }: { modelId: string | null; provider: string | null; tokensIn: number; tokensOut: number; warnings?: string[] }) {
  const { t } = useI18n();
  if (!modelId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 text-[10.5px] text-dim">
      <span>{t('chat.usedModel', { model: `${prettyModelId(modelId)}${provider ? ` · ${providerLabel(provider)}` : ''}` })}</span>
      {tokensIn || tokensOut ? (
        <span>{t('chat.usage', { input: formatNumber(tokensIn), output: formatNumber(tokensOut) })}</span>
      ) : null}
      {warnings?.length ? <Badge tone="warning">{warnings.length} ⚠</Badge> : null}
    </div>
  );
}
