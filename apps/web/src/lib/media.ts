import { getStoredAccessToken } from './api';

/**
 * Appends `?token=...` for `/api/uploads/*` URLs when NOVA_ACCESS_TOKEN is stored,
 * so native `<img>` and `<video>` elements load seamlessly on protected Cloudflare Workers.
 */
export function authMediaUrl(url: string | undefined): string {
  if (!url) return '';
  if (!url.startsWith('/api/uploads/')) return url;
  const tok = getStoredAccessToken();
  if (!tok) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(tok)}`;
}

export function isImageMime(mime: string | undefined, name = ''): boolean {
  if (mime && /^image\//i.test(mime)) return true;
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(name);
}

export function isVideoMime(mime: string | undefined, name = ''): boolean {
  if (mime && /^video\//i.test(mime)) return true;
  return /\.(mp4|webm|mov|mkv|ogv)$/i.test(name);
}

/**
 * Lightweight client-side video keyframe extractor (max 3 JPEG frames @ <=640px).
 * Lets free Vision AI models inspect uploaded videos without straining weak laptops or bandwidth.
 * Safely returns `[]` in headless test environments (jsdom) or unsupported codecs.
 */
export async function extractVideoKeyframes(file: File, maxFrames = 3): Promise<File[]> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return [];
  }
  let objectUrl = '';
  try {
    objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    const loaded = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2500);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(video.videoWidth > 0 && video.videoHeight > 0);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
    if (!loaded) return [];

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 3;
    const count = Math.min(maxFrames, duration < 1.5 ? 1 : 3);
    const timestamps =
      count === 1
        ? [Math.min(0.2, duration * 0.5)]
        : Array.from({ length: count }, (_, i) => Math.min(duration - 0.05, ((i + 0.5) / count) * duration));

    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(64, Math.round(video.videoWidth * scale));
    const height = Math.max(64, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const out: File[] = [];
    const baseName = file.name.replace(/\.[^.]+$/, '');
    for (let i = 0; i < timestamps.length; i++) {
      const t = Math.max(0, timestamps[i]);
      const seekOk = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1800);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve(true);
        };
        video.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
        try {
          video.currentTime = t;
        } catch {
          clearTimeout(timer);
          resolve(false);
        }
      });
      if (!seekOk) continue;
      ctx.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
      if (blob && blob.size > 0) {
        out.push(new File([blob], `${baseName}-frame-${i + 1}.jpg`, { type: 'image/jpeg' }));
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    }
  }
}
