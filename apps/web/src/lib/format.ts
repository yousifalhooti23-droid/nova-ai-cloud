/** Small formatting helpers shared across panels. */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function relativeTime(iso: string | null | undefined, locale: 'ar' | 'en'): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return rtf.format(-seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium' }).format(then);
}

export function absoluteTime(iso: string | null | undefined, locale: 'ar' | 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function shortSha(id: string | null | undefined, len = 7): string {
  if (!id) return '—';
  return id.length > len ? id.slice(0, len) : id;
}

/** `qwen/qwen3.8-27b` → `Qwen3.8 27B`; keeps provider prefixes readable. */
export function prettyModelId(id: string | null | undefined): string {
  if (!id) return '—';
  const upstream = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  const tail = upstream.includes('/') ? upstream.slice(upstream.lastIndexOf('/') + 1) : upstream;
  return tail.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export function providerLabel(id: string): string {
  switch (id) {
    case 'workers-ai': return 'Workers AI';
    case 'openrouter': return 'OpenRouter';
    case 'groq': return 'Groq';
    case 'custom': return 'Custom';
    case 'diagnostic': return 'Diagnostic';
    default: return id;
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Strip the leading `provider:` prefix for display in tight spaces. */
export function stripProvider(id: string): string {
  return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
}
