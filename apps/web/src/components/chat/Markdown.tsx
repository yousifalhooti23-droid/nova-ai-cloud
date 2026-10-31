import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { highlight, normalizeLang } from './Highlight';
import { AiVideoPlayer, GeneratedImageCard, isPreviewableWebsite, WebsitePreviewCard } from './StudioWidgets';
import { cn } from '@/lib/cn';

interface Props {
  content: string;
  copyLabel: string;
  copiedLabel: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * Markdown renderer for assistant messages.
 * Code fences get a language chip + copy button (a hard requirement of the
 * product), complete HTML websites get an interactive Live Website Preview,
 * `nova-video` blocks render in the HD AI Video Player, and images render with zoom + download.
 */
export const Markdown = memo(function Markdown({ content, copyLabel, copiedLabel, isStreaming, className }: Props) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: codeClass, children, ...rest }) {
            const match = /language-([\w-]+)/.exec(codeClass ?? '');
            const raw = String(children ?? '').replace(/\n$/, '');
            const inline = !match && !raw.includes('\n');
            if (inline) {
              return (
                <code className={codeClass} {...rest}>
                  {children}
                </code>
              );
            }
            const lang = match?.[1] ?? normalizeLang(codeClass?.replace('language-', '') ?? '');
            if (lang === 'nova-video' && !isStreaming) {
              return <AiVideoPlayer rawJson={raw} />;
            }
            if (!isStreaming && isPreviewableWebsite(lang, raw)) {
              return (
                <WebsitePreviewCard
                  code={raw}
                  renderCodeBlock={() => (
                    <CodeBlock code={raw} lang={lang} copyLabel={copyLabel} copiedLabel={copiedLabel} />
                  )}
                />
              );
            }
            return (
              <CodeBlock
                code={raw}
                lang={lang}
                copyLabel={copyLabel}
                copiedLabel={copiedLabel}
              />
            );
          },
          pre({ children }) {
            // `code` above already renders the full block; drop the wrapper.
            return <>{children}</>;
          },
          img({ src, alt }) {
            return <GeneratedImageCard src={src} alt={alt} />;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export function CodeBlock({ code, lang, copyLabel, copiedLabel, className }: { code: string; lang?: string; copyLabel: string; copiedLabel: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n').length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className={cn('group/code my-3 overflow-hidden rounded-lg border border-line bg-[#0e1116]', className)}>
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-dim">{lang || 'code'}</span>
        <span className="text-[10.5px] text-dim">· {lines}</span>
        <button
          type="button"
          onClick={copy}
          className="ms-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="scroll-thin overflow-x-auto px-3 py-2.5 text-[12.5px] leading-[1.65]" dir="ltr">
        <code className="font-mono text-[#d6deeb]">{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}
