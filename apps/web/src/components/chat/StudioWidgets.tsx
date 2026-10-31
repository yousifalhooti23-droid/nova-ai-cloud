import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudioVideoScene } from '@nova/shared';
import {
  Code2, Download, Eye, FolderPlus, Globe, Maximize2, Monitor, Pause, Play,
  RotateCcw, Smartphone, Volume2, VolumeX, X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { authMediaUrl } from '@/lib/media';
import { useAppStore } from '@/store/app';
import { useCodeStore } from '@/store/code';

export function isPreviewableWebsite(lang: string | undefined, code: string): boolean {
  const l = (lang ?? '').toLowerCase();
  if (l !== 'html' && l !== 'htm') return false;
  const trimmed = code.trim();
  if (trimmed.length < 90) return false;
  return /<!doctype\s+html|<html[\s>]|<body[\s>]|cdn\.tailwindcss\.com|<section[\s>]|<main[\s>]/i.test(trimmed);
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

  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [savingProject, setSavingProject] = useState(false);

  const downloadHtml = () => {
    const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
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
      const titleMatch = code.match(/<title[^>]*>([^<]+)<\/title>/i);
      const name = (titleMatch?.[1]?.trim() || `nova-site-${Date.now().toString(36).slice(-4)}`).slice(0, 40);
      const { project } = await api.createProject({
        name,
        description: 'Generated in NOVA Website Studio',
        language: 'html',
        files: { 'index.html': code },
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
        <div className="flex justify-center bg-[#141821] p-2">
          <iframe
            title="NOVA Live Website Preview"
            srcDoc={code}
            sandbox="allow-scripts allow-forms allow-modals"
            className={cn(
              'h-[440px] rounded-lg border border-line bg-white transition-all',
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
            title="NOVA Fullscreen Website Preview"
            srcDoc={code}
            sandbox="allow-scripts allow-forms allow-modals"
            className="min-h-0 flex-1 w-full rounded-xl border border-line bg-white"
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

interface ParsedVideoPayload {
  title: string;
  lang?: 'ar' | 'en';
  scenes: StudioVideoScene[];
}

/**
 * Multi-Scene Cloud AI Video Player + WebM Video Exporter:
 * Plays cloud-generated AI frames with smooth 60fps Ken Burns camera motion, crossfades,
 * cinema subtitles, optional speech narration, and 1-click `.webm` video file export.
 */
export function AiVideoPlayer({ rawJson }: { rawJson: string }) {
  const { t } = useI18n();
  const parsed = useMemo<ParsedVideoPayload | null>(() => {
    try {
      const obj = JSON.parse(rawJson) as ParsedVideoPayload;
      if (!obj || !Array.isArray(obj.scenes) || obj.scenes.length === 0) return null;
      return obj;
    } catch {
      return null;
    }
  }, [rawJson]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sceneIdx, setSceneIdx] = useState(0);
  const startRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const lastSpokenRef = useRef<number>(-1);

  const totalSec = useMemo(
    () => (parsed ? parsed.scenes.reduce((acc, s) => acc + (s.durationSec || 3.5), 0) : 14),
    [parsed],
  );

  // Preload cloud-generated scene images
  useEffect(() => {
    if (!parsed) return;
    imagesRef.current = new Array(parsed.scenes.length).fill(null);
    setLoadedCount(0);
    parsed.scenes.forEach((scene, idx) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imagesRef.current[idx] = img;
        setLoadedCount((n) => n + 1);
      };
      img.onerror = () => {
        setLoadedCount((n) => n + 1);
      };
      img.src = authMediaUrl(scene.imageUrl);
    });
  }, [parsed]);

  // Draw frame at `timeSec`
  const renderAt = (timeSec: number) => {
    if (!parsed || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;

    let acc = 0;
    let active = 0;
    let localT = 0;
    for (let i = 0; i < parsed.scenes.length; i++) {
      const dur = parsed.scenes[i].durationSec || 3.5;
      if (timeSec < acc + dur || i === parsed.scenes.length - 1) {
        active = i;
        localT = Math.min(1, Math.max(0, (timeSec - acc) / dur));
        break;
      }
      acc += dur;
    }
    setSceneIdx(active);

    ctx.fillStyle = '#090c12';
    ctx.fillRect(0, 0, W, H);

    const drawSceneImage = (idx: number, prog: number, alpha: number) => {
      const img = imagesRef.current[idx];
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const motion = parsed.scenes[idx]?.motion ?? 'zoom-in';
      let scale = 1.06;
      let ox = 0;
      let oy = 0;
      if (motion === 'zoom-in') scale = 1.0 + prog * 0.12;
      else if (motion === 'zoom-out') scale = 1.12 - prog * 0.11;
      else if (motion === 'pan-left') {
        scale = 1.1;
        ox = (0.5 - prog) * W * 0.06;
      } else if (motion === 'pan-right') {
        scale = 1.1;
        ox = (prog - 0.5) * W * 0.06;
      }

      const imgRatio = img.naturalWidth / img.naturalHeight;
      const canvasRatio = W / H;
      let dw = W * scale;
      let dh = H * scale;
      if (imgRatio > canvasRatio) dw = dh * imgRatio;
      else dh = dw / imgRatio;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, (W - dw) / 2 + ox, (H - dh) / 2 + oy, dw, dh);
      ctx.restore();
    };

    drawSceneImage(active, localT, 1);
    // Smooth crossfade into next scene in final 18% of scene
    if (localT > 0.82 && active + 1 < parsed.scenes.length) {
      const fadeAlpha = (localT - 0.82) / 0.18;
      drawSceneImage(active + 1, 0, fadeAlpha);
    }

    // Bottom cinema gradient + caption
    const grad = ctx.createLinearGradient(0, H * 0.65, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.82)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.65, W, H * 0.35);

    const caption = parsed.scenes[active]?.caption ?? '';
    if (caption) {
      ctx.save();
      ctx.font = '600 21px system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 8;
      ctx.fillText(caption, W / 2, H - 28, W - 64);
      ctx.restore();
    }
  };

  // Animation loop
  useEffect(() => {
    if (!parsed || loadedCount === 0) return;
    if (!playing) {
      renderAt(elapsedRef.current);
      return;
    }
    let raf = 0;
    startRef.current = performance.now() - elapsedRef.current * 1000;

    const tick = (now: number) => {
      const elapsed = (now - startRef.current) / 1000;
      if (elapsed >= totalSec) {
        elapsedRef.current = 0;
        startRef.current = now;
        lastSpokenRef.current = -1;
        setProgress(100);
        renderAt(totalSec - 0.01);
        setPlaying(false);
        return;
      }
      elapsedRef.current = elapsed;
      setProgress(Math.min(100, (elapsed / totalSec) * 100));
      renderAt(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [parsed, loadedCount, playing, totalSec]);

  // Optional Web Speech narration when unmuted
  useEffect(() => {
    if (!parsed || muted || !playing || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (lastSpokenRef.current === sceneIdx) return;
    lastSpokenRef.current = sceneIdx;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(parsed.scenes[sceneIdx]?.caption ?? '');
      u.lang = parsed.lang === 'ar' ? 'ar-SA' : 'en-US';
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore speech errors */
    }
  }, [sceneIdx, muted, playing, parsed]);

  const exportWebm = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !parsed || exporting || typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') return;
    setExporting(true);
    setPlaying(false);
    try {
      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });
      recorder.start();
      const fps = 24;
      const totalFrames = Math.ceil(totalSec * fps);
      for (let f = 0; f <= totalFrames; f++) {
        renderAt((f / totalFrames) * totalSec);
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
      recorder.stop();
      const blob = await done;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nova-video-${Date.now().toString(36)}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } finally {
      setExporting(false);
    }
  };

  if (!parsed) return null;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-accent/35 bg-[#0b0e14] shadow-lg">
      <div className="relative aspect-video w-full bg-black">
        <canvas ref={canvasRef} width={768} height={432} className="h-full w-full object-cover" />
        {loadedCount === 0 ? (
          <div className="absolute inset-0 grid place-items-center bg-black/70 text-[12px] text-muted">
            {t('common.loading')}
          </div>
        ) : null}
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full bg-line">
        <div className="h-full bg-accent transition-all duration-150" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-surface px-3 py-2 text-[11.5px]">
        <button
          type="button"
          onClick={() => {
            if (!playing && progress >= 99) {
              elapsedRef.current = 0;
              setProgress(0);
            }
            setPlaying((p) => !p);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2.5 py-1 font-medium text-text hover:border-accent/50"
        >
          {playing ? <Pause size={12} /> : progress >= 99 ? <RotateCcw size={12} /> : <Play size={12} />}
          {playing ? t('studio.pause') : progress >= 99 ? t('studio.replay') : t('studio.play')}
        </button>

        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-1 text-muted hover:text-text"
          title={t('studio.voiceover')}
        >
          {muted ? <VolumeX size={12} /> : <Volume2 size={12} className="text-accent" />}
        </button>

        <span className="truncate text-dim">
          {parsed.title} · {sceneIdx + 1}/{parsed.scenes.length}
        </span>

        <button
          type="button"
          disabled={exporting || loadedCount < parsed.scenes.length}
          onClick={() => void exportWebm()}
          className="ms-auto inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-text disabled:opacity-50"
        >
          <Download size={11} />
          {exporting ? t('studio.exportingVideo') : t('studio.downloadVideo')}
        </button>
      </div>
    </div>
  );
}
