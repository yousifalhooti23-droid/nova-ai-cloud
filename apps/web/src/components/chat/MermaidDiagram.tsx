import { memo, useEffect, useRef, useState } from 'react';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  code: string;
}

let mermaidLoaded = false;
let mermaidPromise: Promise<any> | null = null;

async function loadMermaid(): Promise<any> {
  if (mermaidLoaded && (window as any).mermaid) {
    return (window as any).mermaid;
  }
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = new Promise((resolve) => {
    // Check if script is already injected
    if (document.getElementById('mermaid-cdn-script')) {
      const check = setInterval(() => {
        if ((window as any).mermaid) {
          clearInterval(check);
          mermaidLoaded = true;
          resolve((window as any).mermaid);
        }
      }, 50);
      return;
    }

    const script = document.createElement('script');
    script.id = 'mermaid-cdn-script';
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.async = true;
    script.onload = () => {
      const m = (window as any).mermaid;
      if (m) {
        m.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: '#0d1117',
            primaryColor: '#38bdf8',
            primaryTextColor: '#f8fafc',
            primaryBorderColor: '#0284c7',
            lineColor: '#64748b',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a',
          },
          securityLevel: 'loose',
        });
        mermaidLoaded = true;
        resolve(m);
      } else {
        resolve(null);
      }
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return mermaidPromise;
}

export const MermaidDiagram = memo(function MermaidDiagram({ code }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const render = async () => {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;
        if (!mermaid) {
          setError('تعذر تحميل مكتبة Mermaid للرسم البياني.');
          setLoading(false);
          return;
        }

        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const cleanCode = code.trim();
        const { svg: renderedSvg } = await mermaid.render(id, cleanCode);
        if (!cancelled) {
          setSvg(renderedSvg);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-sky-500/30 bg-[#0d1117] shadow-lg">
      <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5 text-[11px] text-muted">
        <span className="font-semibold text-sky-400">📊 مخطط تفاعلي (Mermaid Diagram)</span>
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-panel hover:text-text"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          <span>{copied ? 'تم النسخ' : 'نسخ الكود'}</span>
        </button>
      </div>

      <div className="p-3 sm:p-4 overflow-x-auto flex items-center justify-center min-h-[120px]">
        {loading ? (
          <div className="flex items-center gap-2 text-dim text-[12px] py-4">
            <RefreshCw size={14} className="animate-spin text-sky-400" />
            <span>جارِ رسم المخطط التفاعلي...</span>
          </div>
        ) : error ? (
          <div className="w-full text-right text-[12px] text-danger/80 p-2">
            <p className="font-medium text-danger">تعذر معالجة رسم المخطط:</p>
            <pre className="mt-1 font-mono text-[10.5px] text-dim whitespace-pre-wrap">{error}</pre>
            <pre className="mt-2 font-mono text-[10.5px] text-muted bg-panel p-2 rounded">{code}</pre>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
});
