import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/store/app';
import { useCodeStore } from '@/store/code';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';

/**
 * Terminal UI.
 *
 * Commands are POSTed to the worker, which forwards them to the configured
 * sandbox adapter (isolated Worker or external service). When no sandbox is
 * configured the worker refuses — and this panel says so instead of pretending
 * the command ran.
 */
export function TerminalPanel() {
  const { t, locale } = useI18n();
  const entries = useCodeStore((s) => s.terminal);
  const runCommand = useCodeStore((s) => s.runCommand);
  const clearTerminal = useCodeStore((s) => s.clearTerminal);
  const sandbox = useAppStore((s) => s.sandbox);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const bodyRef = useRef<HTMLDivElement>(null);

  const busy = entries.some((e) => e.running);
  const disabled = !sandbox?.ready;

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, busy]);

  const submit = async () => {
    const cmd = value.trim();
    if (!cmd || busy || disabled) return;
    setHistory((h) => [...h.slice(-40), cmd]);
    setCursor(-1);
    setValue('');
    await runCommand(cmd);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2">
        <Badge tone={disabled ? 'warning' : 'success'}>
          {disabled ? <TriangleAlert size={10} /> : <ShieldCheck size={10} />}
          {t('terminal.isolated')}: {sandbox?.kind ?? '—'}
        </Badge>
        <span className="truncate text-[10.5px] text-dim">{sandbox?.detail}</span>
        <Button size="sm" variant="ghost" className="ms-auto" icon={<Trash2 size={11} />} onClick={clearTerminal} disabled={entries.length === 0}>
          {t('terminal.clear')}
        </Button>
      </div>

      {disabled ? (
        <div className="border-b border-warning/25 bg-warning/8 px-3 py-2">
          <p className="text-[11.5px] leading-relaxed text-warning">
            {t('terminal.disabledHint')}
          </p>
        </div>
      ) : null}

      <div ref={bodyRef} className="scroll-thin min-h-0 flex-1 bg-[#0a0c0f] p-2.5 font-mono text-[12px]" dir="ltr">
        {entries.length === 0 ? (
          <div className="text-dim">
            <EmptyState title={disabled ? t('terminal.disabled') : t('terminal.empty')} hint={sandbox?.detail} />
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="mb-2.5">
              <div className="flex items-baseline gap-1.5">
                <span className="select-none text-accent">$</span>
                <span className="break-all text-text">{e.command}</span>
                {e.running ? <Spinner size={11} className="ms-1" /> : null}
              </div>
              {e.stdout ? <pre className="mt-1 whitespace-pre-wrap break-words text-[#c9d1d9]">{e.stdout}</pre> : null}
              {e.stderr ? <pre className="mt-1 whitespace-pre-wrap break-words text-[#f0a3ab]">{e.stderr}</pre> : null}
              {e.error ? (
                <pre className="mt-1 whitespace-pre-wrap break-words text-warning">{e.error}</pre>
              ) : null}
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-dim">
                <span className={cn(e.exitCode === 0 && e.ok ? 'text-success' : 'text-danger')}>
                  {t('terminal.exitCode', { code: e.exitCode ?? '—' })}
                </span>
                <span>{e.durationMs}ms</span>
                {e.adapter ? <span className="rounded border border-line-strong px-1">{e.adapter}</span> : null}
                <span>{new Date(e.at).toLocaleTimeString(locale === 'ar' ? 'ar' : 'en-GB')}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-2.5 py-2">
        <span className="select-none font-mono text-[12px] text-accent">$</span>
        <input
          value={value}
          disabled={busy || disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (history.length) {
                const next = cursor < 0 ? history.length - 1 : Math.max(0, cursor - 1);
                setCursor(next);
                setValue(history[next] ?? '');
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (cursor >= 0) {
                const next = cursor + 1;
                if (next >= history.length) {
                  setCursor(-1);
                  setValue('');
                } else {
                  setCursor(next);
                  setValue(history[next] ?? '');
                }
              }
            }
          }}
          placeholder={disabled ? t('terminal.disabled') : t('terminal.placeholder')}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-text outline-none placeholder:text-dim disabled:opacity-50"
          dir="ltr"
        />
        <Button size="sm" variant="outline" disabled={busy || disabled || !value.trim()} onClick={() => void submit()}>
          <CornerDownLeft size={12} />
          {t('terminal.run')}
        </Button>
      </div>
    </div>
  );
}
