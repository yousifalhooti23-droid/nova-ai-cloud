import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'success';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  loading?: boolean;
}

export function Button({ variant = 'outline', size = 'md', icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  active?: boolean;
  size?: number;
}

export function IconButton({ label, variant = 'ghost', active, className, children, size: iconSize, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'btn btn-icon',
        `btn-${variant}`,
        active && 'bg-elevated text-text border-line-strong',
        className,
      )}
      {...rest}
    >
      {children ?? <span style={{ width: iconSize ?? 15, height: iconSize ?? 15 }} />}
    </button>
  );
}

/* ------------------------------------------------------------------- Badge */

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-line-strong bg-elevated text-muted',
  accent: 'border-accent/40 bg-accent/12 text-accent',
  success: 'border-success/35 bg-success/12 text-success',
  warning: 'border-warning/35 bg-warning/12 text-warning',
  danger: 'border-danger/35 bg-danger/12 text-danger',
  info: 'border-info/35 bg-info/12 text-info',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] leading-none font-medium whitespace-nowrap', badgeTones[tone], className)}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', pulse }: { tone?: BadgeTone; pulse?: boolean }) {
  const colors: Record<BadgeTone, string> = {
    neutral: 'bg-dim',
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
  };
  return <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', colors[tone], pulse && 'pulse-dot')} />;
}

/* ----------------------------------------------------------------- Spinner */

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-muted', className)} />;
}

/* -------------------------------------------------------------- Form bits */

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11.5px] leading-relaxed text-dim">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('input', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn('input appearance-none pe-8 cursor-pointer', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-dim" />
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-[13px] text-text">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-dim">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full border transition-colors disabled:opacity-40',
          checked ? 'border-accent/60 bg-accent/70' : 'border-line-strong bg-elevated',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] h-[16px] w-[16px] rounded-full bg-text transition-all',
            checked ? 'start-[19px]' : 'start-[2px]',
          )}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { id: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-lg border border-line bg-surface p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-[6px] px-2.5 py-1 text-[12px] transition-colors',
            value === o.id ? 'bg-elevated text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- Modal */

export function Modal({
  open, onClose, title, children, footer, width = 560, subtitle,
}: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-in relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl"
        style={{ maxWidth: width }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[11.5px] text-dim">{subtitle}</p> : null}
          </div>
          <IconButton label="×" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="scroll-thin flex-1 px-4 py-3.5">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface/60 px-4 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel, tone = 'danger', onConfirm, onClose, busy,
}: { open: boolean; title: string; body: string; confirmLabel: string; cancelLabel: string; tone?: ButtonVariant; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{body}</p>
    </Modal>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-1 text-dim">{icon}</div> : null}
      <p className="text-[13.5px] font-medium text-muted">{title}</p>
      {hint ? <p className="max-w-sm text-[12px] leading-relaxed text-dim">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Dropdown */

interface DropdownCtxValue { close: () => void }
const DropdownCtx = createContext<DropdownCtxValue | null>(null);

export function useDropdown() {
  return useContext(DropdownCtx);
}

export function Dropdown({ trigger, children, align = 'start', width = 260, className }: { trigger: (props: { open: boolean; toggle: () => void }) => ReactNode; children: ReactNode; align?: 'start' | 'end'; width?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const ctx = useMemo<DropdownCtxValue>(() => ({ close: () => setOpen(false) }), []);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open ? (
        <DropdownCtx.Provider value={ctx}>
          <div
            className={cn(
              'animate-in absolute z-40 mt-1.5 overflow-hidden rounded-lg border border-line-strong bg-elevated p-1 shadow-xl',
              align === 'end' ? 'end-0' : 'start-0',
            )}
            style={{ width }}
          >
            {children}
          </div>
        </DropdownCtx.Provider>
      ) : null}
    </div>
  );
}

export function DropdownItem({ children, onClick, selected, disabled, tone, icon }: { children: ReactNode; onClick?: () => void; selected?: boolean; disabled?: boolean; tone?: 'danger'; icon?: ReactNode }) {
  const ctx = useDropdown();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClick?.();
        ctx?.close();
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12.5px] transition-colors disabled:opacity-40',
        tone === 'danger' ? 'text-danger hover:bg-danger/12' : 'text-text hover:bg-line/70',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <Check size={13} className="text-accent" /> : null}
    </button>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-dim">{children}</div>;
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-line" />;
}

/* ------------------------------------------------------------------ Toasts */

export function ToastStack({ toasts, onDismiss, labels }: { toasts: { id: string; kind: 'info' | 'success' | 'error'; message: string; hint?: string }[]; onDismiss: (id: string) => void; labels: { error: string; success: string } }) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'animate-in pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-xl backdrop-blur',
            t.kind === 'error' ? 'border-danger/40 bg-[#23141a]/95' : t.kind === 'success' ? 'border-success/35 bg-[#131f18]/95' : 'border-line-strong bg-elevated/95',
          )}
        >
          <Dot tone={t.kind === 'error' ? 'danger' : t.kind === 'success' ? 'success' : 'info'} />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-snug text-text">
              {t.message === 'network' ? labels.error : t.message}
            </p>
            {t.hint ? <p className="mt-0.5 break-words text-[11.5px] leading-snug text-dim">{t.hint}</p> : null}
          </div>
          <button type="button" onClick={() => onDismiss(t.id)} className="text-dim transition-colors hover:text-text" aria-label="×">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------- CopyButton */

export function CopyButton({ value, label, copiedLabel, className, size = 'sm' }: { value: string; label: string; copiedLabel: string; className?: string; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [value]);

  return (
    <Button size={size} variant="ghost" className={cn('gap-1', className)} onClick={copy} title={label}>
      {copied ? <Check size={12} className="text-success" /> : null}
      {copied ? copiedLabel : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ Kbd */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------- SectionTitle */

export function SectionTitle({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim">
        {icon}
        {children}
      </div>
      {action}
    </div>
  );
}
