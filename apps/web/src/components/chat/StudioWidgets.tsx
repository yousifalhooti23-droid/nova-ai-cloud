import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Code2, Download, Eye, FolderPlus, Globe, Maximize2, Monitor,
  RotateCcw, Smartphone, X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { authMediaUrl } from '@/lib/media';
import { useAppStore } from '@/store/app';
import { useChatStore } from '@/store/chat';
import { useCodeStore } from '@/store/code';

export function isPreviewableWebsite(lang: string | undefined, code: string): boolean {
  const l = (lang ?? '').toLowerCase();
  if (l !== 'html' && l !== 'htm') return false;
  const trimmed = code.trim();
  if (trimmed.length < 90) return false;
  return /<!doctype\s+html|<html[\s>]|<body[\s>]|cdn\.tailwindcss\.com|<section[\s>]|<main[\s>]/i.test(trimmed);
}

export interface PreparedWebsite {
  html: string;
  isTruncated: boolean;
  hasBody: boolean;
  title: string;
}

/**
 * Robust HTML sanitizer, storage polyfill injector, and auto-repairer.
 * Solves:
 *   1. Unclosed markdown fences or tags when token limits are reached mid-stream.
 *   2. Crashes from `window.localStorage` / `window.sessionStorage` inside opaque sandboxed iframes.
 *   3. Missing <body> elements so users never see a blank white canvas without explanation.
 */
export function prepareWebsiteHtml(rawCode: string): PreparedWebsite {
  let clean = rawCode.trim();

  // 1. Strip residual markdown fences if present
  clean = clean.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 2. Extract title if present
  const titleMatch = clean.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1]?.trim() || 'NOVA Live Website Preview').slice(0, 50);

  // 3. Inspect tag balance
  const openStyles = (clean.match(/<style[\s>]/gi) || []).length;
  const closeStyles = (clean.match(/<\/style>/gi) || []).length;
  const unclosedStyle = openStyles > closeStyles;

  const openScripts = (clean.match(/<script[\s>]/gi) || []).length;
  const closeScripts = (clean.match(/<\/script>/gi) || []).length;
  const unclosedScript = openScripts > closeScripts;

  const hasBodyOpen = /<body[\s>]/i.test(clean);
  const hasBodyClose = /<\/body>/i.test(clean);
  const hasHtmlClose = /<\/html>/i.test(clean);

  // Check if body has real substantial content (not just an empty body tag)
  const bodyContentMatch = clean.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const rawBodyInner = bodyContentMatch ? bodyContentMatch[1] : (hasBodyOpen ? clean.slice(clean.search(/<body[\s>]/i)) : '');
  const strippedText = rawBodyInner.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').trim();
  const hasSubstantialBody = strippedText.length >= 10 || /<(?:img|svg|canvas|video|button|input|form|section|article|nav|header|footer|h1|h2|h3|p)/i.test(rawBodyInner);

  const isTruncated = unclosedStyle || unclosedScript || (hasBodyOpen && !hasBodyClose) || !hasBodyOpen || !hasSubstantialBody;

  // 4. Auto-repair open tags
  if (unclosedStyle) {
    clean += '\n</style>';
  }
  if (unclosedScript) {
    clean += '\n</script>';
  }

  // 5. Shim localStorage & sessionStorage so sandboxed scripts don't crash on opaque origin
  const storageShim = `<script>
(function() {
  function makeMock() {
    var mem = {};
    return {
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function(k, v) { mem[k] = String(v); },
      removeItem: function(k) { delete mem[k]; },
      clear: function() { mem = {}; },
      key: function(i) { return Object.keys(mem)[i] || null; },
      get length() { return Object.keys(mem).length; }
    };
  }
  try { window.localStorage.getItem('_t'); } catch(e) {
    try { Object.defineProperty(window, 'localStorage', { value: makeMock(), configurable: true, writable: true }); } catch(_) {}
  }
  try { window.sessionStorage.getItem('_t'); } catch(e) {
    try { Object.defineProperty(window, 'sessionStorage', { value: makeMock(), configurable: true, writable: true }); } catch(_) {}
  }
  window.addEventListener('error', function(e) {
    var errEl = document.getElementById('nova-script-err');
    if (!errEl && document.body) {
      errEl = document.createElement('div');
      errEl.id = 'nova-script-err';
      errEl.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;background:#1e1418;border:1px solid rgba(239,68,68,0.5);color:#fca5a5;padding:8px 12px;border-radius:8px;font-size:11.5px;font-family:sans-serif;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.5);display:flex;align-items:center;gap:8px;';
      errEl.innerHTML = '<span style="color:#ef4444;font-size:14px;">⚠️</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">تنبيه كود الموقع: ' + (e.message || 'Error') + '</span>';
      document.body.appendChild(errEl);
    }
  });
})();
</script>`;

  // 5b. Synthesize standard :root CSS variables for any @property definitions (fixes white canvas on Houdini-unsupported WebViews)
  const houdiniProps: string[] = [];
  const propertyRe = /@property\s+(--[\w-]+)\s*\{[^}]*initial-value\s*:\s*([^;]+);/gi;
  let propMatch: RegExpExecArray | null;
  while ((propMatch = propertyRe.exec(clean)) !== null) {
    houdiniProps.push(`${propMatch[1]}: ${propMatch[2].trim()};`);
  }
  const synthesizedRootStyle = houdiniProps.length > 0 ? `<style>\n:root {\n  ${houdiniProps.join('\n  ')}\n}\n</style>` : '';

  // Base typography & contrast rendering fallback (ensures text is NEVER invisible and animation opacity is visible)
  const baseFallbackStyle = `<style>
  html {
    background-color: #0b0e14;
    color: #f1f5f9;
    color-scheme: dark;
  }
  body {
    margin: 0;
    min-height: 100vh;
    background-color: #0b0e14;
    color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Tajawal", sans-serif;
  }
  /* Animation safety: if AOS, GSAP, or Wow.js fails to initialize, elements must not stay stuck at opacity:0 */
  [data-aos], .fade-in, .animate-fade, .opacity-0 {
    opacity: 1 !important;
    visibility: visible !important;
    transform: none !important;
  }
</style>`;

  // 6. Handle truncated code that ended before <body> or before substantial content
  if (!hasBodyOpen || !hasSubstantialBody) {
    if (/<head[\s>]/i.test(clean) && !/<\/head>/i.test(clean)) {
      clean += '\n</head>';
    }
    const truncatedNotice = `
<body class="bg-[#0b0e14] text-slate-100 min-h-screen flex items-center justify-center p-4" dir="rtl" style="font-family: system-ui, -apple-system, 'Cairo', 'Tajawal', sans-serif;">
  <div style="max-width: 520px; width: 100%; background: #141821; border: 1px solid rgba(200, 150, 62, 0.4); border-radius: 16px; padding: 24px; text-align: center; box-shadow: 0 16px 36px rgba(0,0,0,0.5);">
    <div style="font-size: 32px; margin-bottom: 12px;">🎨</div>
    <h3 style="font-size: 16px; font-weight: 700; color: #f1f5f9; margin-bottom: 8px;">كود الموقع قيد الإنشاء أو توقف قبل عناصر الصفحة</h3>
    <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin-bottom: 16px;">
      قام النموذج بكتابة إعدادات الترويسة (${hasBodyOpen ? 'وتوقف التوليد عند حد الرموز قبل اكتمال عناصر الصفحة' : 'وتوقف التوليد عند حد الرموز قبل كتابة وسوم <body>'}).
    </p>
    <div style="background: #0d1017; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; text-align: right; font-size: 12px; color: #cbd5e1;">
      <span style="color: #eab308; font-weight: 600;">💡 الحل السريع:</span>
      <div style="margin-top: 4px;">انقر على زر <strong>"استكمال كتابة كود الموقع"</strong> في الأعلى أو أرسل كلمة "أكمل" في المحادثة لمتابعة كتابة عناصر الصفحة.</div>
    </div>
  </div>
</body>
</html>`;
    if (!hasBodyOpen) {
      clean += truncatedNotice;
    } else {
      // Replace empty body with informative notice so user never sees a blank white square
      clean = clean.replace(/<body[^>]*>[\s\S]*$/i, truncatedNotice);
    }
  } else {
    if (!hasBodyClose) clean += '\n</body>';
    if (!hasHtmlClose) clean += '\n</html>';
  }

  // Inject storage shim, synthesized root variables & fallback styles
  const injectedHead = `${storageShim}\n${synthesizedRootStyle}\n${baseFallbackStyle}`;
  if (/<head[\s>]/i.test(clean)) {
    clean = clean.replace(/<head[\s>]/i, (match) => `${match}\n${injectedHead}`);
  } else {
    clean = `${injectedHead}\n${clean}`;
  }

  return {
    html: clean,
    isTruncated,
    hasBody: hasBodyOpen,
    title,
  };
}

/**
 * Interactive Website Studio Card:
 * Renders generated HTML websites inside a sandboxed iframe with Desktop/Mobile viewport toggle,
 * Fullscreen mode, 1-click `.html` download, and 1-click "Save to Coding Workspace".
 */
export function WebsitePreviewCard({
  code,
  renderCodeBlock,
}: {
  code: string;
  renderCodeBlock: () => React.ReactNode;
}) {
  const { t } = useI18n();
  const toast = useAppStore((s) => s.toast);
  const setView = useAppStore((s) => s.setView);
  const selectProject = useCodeStore((s) => s.selectProject);
  const loadProjects = useCodeStore((s) => s.loadProjects);
  const send = useChatStore((s) => s.send);

  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const prep = useMemo(() => prepareWebsiteHtml(code), [code]);

  const downloadHtml = () => {
    const blob = new Blob([prep.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nova-website-${Date.now().toString(36)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const saveAsProject = async () => {
    setSavingProject(true);
    try {
      const name = (prep.title || `nova-site-${Date.now().toString(36).slice(-4)}`).slice(0, 40);
      const { project } = await api.createProject({
        name,
        description: 'Generated in NOVA Website Studio',
        language: 'html',
        files: { 'index.html': prep.html },
      });
      await loadProjects();
      await selectProject(project.id);
      toast({ kind: 'success', message: t('studio.savedToWorkspace') });
      setView('code');
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : t('error.generic') });
    } finally {
      setSavingProject(false);
    }
  };

  const handleContinue = () => {
    void send('أكمل كتابة كود الموقع واكتب عناصر body مباشرة بتنسيق Tailwind مع إغلاق </body></html>');
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-accent/35 bg-[#0e1116] shadow-lg">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-accent">
          <Globe size={13} />
          {t('studio.websiteTitle')}
        </span>

        <div className="ms-2 flex items-center rounded-lg border border-line bg-panel p-0.5">
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
              tab === 'preview' ? 'bg-accent/15 font-medium text-accent' : 'text-dim hover:text-text',
            )}
          >
            <Eye size={11} />
            {t('studio.livePreview')}
          </button>
          <button
            type="button"
            onClick={() => setTab('code')}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
              tab === 'code' ? 'bg-accent/15 font-medium text-accent' : 'text-dim hover:text-text',
            )}
          >
            <Code2 size={11} />
            {t('studio.sourceCode')}
          </button>
        </div>

        {tab === 'preview' ? (
          <div className="hidden items-center rounded-lg border border-line bg-panel p-0.5 sm:flex">
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              className={cn('rounded-md p-1 transition-colors', viewport === 'desktop' ? 'bg-elevated text-accent' : 'text-dim hover:text-text')}
              title="Desktop"
            >
              <Monitor size={12} />
            </button>
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              className={cn('rounded-md p-1 transition-colors', viewport === 'mobile' ? 'bg-elevated text-accent' : 'text-dim hover:text-text')}
              title="Mobile"
            >
              <Smartphone size={12} />
            </button>
          </div>
        ) : null}

        <div className="ms-auto flex items-center gap-1">
          {tab === 'preview' ? (
            <button
              type="button"
              onClick={() => setPreviewKey((k) => k + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] text-muted transition-colors hover:text-text"
              title={t('studio.reloadPreview')}
            >
              <RotateCcw size={11} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={downloadHtml}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] text-muted transition-colors hover:text-text"
          >
            <Download size={11} />
            <span className="hidden sm:inline">{t('studio.downloadSite')}</span>
          </button>
          <button
            type="button"
            disabled={savingProject}
            onClick={() => void saveAsProject()}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] text-muted transition-colors hover:text-text disabled:opacity-50"
          >
            <FolderPlus size={11} />
            <span className="hidden md:inline">{t('studio.openInWorkspace')}</span>
          </button>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] text-muted transition-colors hover:text-text"
            title={t('studio.fullscreen')}
          >
            <Maximize2 size={11} />
          </button>
        </div>
      </div>

      {tab === 'preview' ? (
        <div className="flex flex-col items-center bg-[#141821] p-2">
          {prep.isTruncated ? (
            <div className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
              <span className="flex items-center gap-1.5 font-medium">
                <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                {t('studio.truncatedAlert')}
              </span>
              <button
                type="button"
                onClick={handleContinue}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/25 px-2.5 py-1 text-[11.5px] font-semibold text-amber-100 hover:bg-amber-500/40 transition-colors"
              >
                {t('studio.continueBtn')}
              </button>
            </div>
          ) : null}

          <iframe
            key={previewKey}
            title="NOVA Live Website Preview"
            srcDoc={prep.html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className={cn(
              'h-[460px] rounded-lg border border-line bg-[#0d1117] transition-all',
              viewport === 'mobile' ? 'w-[390px] max-w-full shadow-2xl' : 'w-full',
            )}
          />
        </div>
      ) : (
        <div className="[&>div]:!my-0 [&>div]:!rounded-none [&>div]:!border-0">{renderCodeBlock()}</div>
      )}

      {fullscreen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3 backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-2">
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-accent">
              <Globe size={15} />
              {t('studio.websiteTitle')}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewKey((k) => k + 1)}
                className="btn btn-outline !py-1 text-[12px]"
                title={t('studio.reloadPreview')}
              >
                <RotateCcw size={13} />
              </button>
              <button
                type="button"
                onClick={downloadHtml}
                className="btn btn-outline !py-1 text-[12px]"
              >
                <Download size={13} />
                {t('studio.downloadSite')}
              </button>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                className="btn btn-ghost !p-1.5"
                aria-label={t('common.close')}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <iframe
            key={`fs-${previewKey}`}
            title="NOVA Fullscreen Website Preview"
            srcDoc={prep.html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="min-h-0 flex-1 w-full rounded-xl border border-line bg-[#0d1117]"
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Generated / Inline Image Card with zoom lightbox + 1-click download.
 */
export function GeneratedImageCard({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useI18n();
  const [zoomed, setZoomed] = useState(false);
  const resolved = authMediaUrl(src);
  if (!resolved) return null;

  return (
    <>
      <span className="my-2.5 block overflow-hidden rounded-xl border border-line bg-[#0e1116]">
        <img
          src={resolved}
          alt={alt || 'Generated image'}
          loading="lazy"
          onClick={() => setZoomed(true)}
          className="max-h-[460px] w-full cursor-zoom-in object-contain bg-black/40"
        />
        <span className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-1.5 text-[11px] text-dim">
          <span className="truncate">{alt || t('studio.generatedImage')}</span>
          <a
            href={resolved}
            download={`nova-image-${Date.now().toString(36)}.jpg`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-elevated px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-text no-underline"
          >
            <Download size={11} />
            {t('studio.downloadImage')}
          </a>
        </span>
      </span>

      {zoomed ? (
        <span
          role="dialog"
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <img src={resolved} alt={alt || ''} className="max-h-[90vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" />
        </span>
      ) : null}
    </>
  );
}
