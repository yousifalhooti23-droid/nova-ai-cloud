import type {
  StudioImageRequest,
  StudioImageResponse,
  StudioVideoRequest,
  StudioVideoResponse,
  StudioVideoScene,
} from '@nova/shared';
import { newId, truncate } from '@nova/shared';
import type { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context.js';
import { badRequest, HttpError } from '../lib/errors.js';

const MOTIONS: StudioVideoScene['motion'][] = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right'];

/**
 * Free Cloud Creative Studio routes:
 * - POST /api/studio/image -> 100% free cloud GPU image generation (Workers AI Flux -> Pollinations Sana)
 * - POST /api/studio/video -> 100% free cloud GPU multi-scene AI video storyboard & HD frame generation
 */
export function registerStudioRoutes(app: Hono<AppEnv>) {
  app.post('/api/studio/image', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => null)) as StudioImageRequest | null;
    if (!req || typeof req.prompt !== 'string' || !req.prompt.trim()) {
      throw badRequest('prompt is required', 'bad_prompt');
    }
    const res = await generateCloudImage(d, {
      prompt: req.prompt.trim(),
      width: clampDim(req.width ?? 1024),
      height: clampDim(req.height ?? 1024),
      conversationId: req.conversationId ?? null,
      projectId: req.projectId ?? null,
      signal: c.req.raw.signal,
    });
    return c.json(res, 201);
  });

  app.post('/api/studio/video', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => null)) as StudioVideoRequest | null;
    if (!req || typeof req.prompt !== 'string' || !req.prompt.trim()) {
      throw badRequest('prompt is required', 'bad_prompt');
    }
    const res = await generateCloudVideo(d, {
      prompt: req.prompt.trim(),
      locale: req.locale,
      conversationId: req.conversationId ?? null,
      projectId: req.projectId ?? null,
      signal: c.req.raw.signal,
    });
    return c.json(res, 201);
  });
}

function clampDim(n: number): number {
  if (!Number.isFinite(n)) return 1024;
  return Math.min(Math.max(Math.round(n / 64) * 64, 256), 1280);
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:image\/\w+;base64,/, '').trim();
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

/**
 * Optionally translates/expands a user prompt into a crisp English visual prompt
 * when a free text LLM is configured; falls back gracefully with zero errors.
 */
async function refineVisualPrompt(d: AppDeps, rawPrompt: string, skipEnhance = false): Promise<string> {
  const clean = rawPrompt
    .replace(/^(ارسم|انشئ صورة|أنشئ صورة|ولد صورة|ولّد صورة|صمم صورة|ابغى صورة|أريد صورة|سوي صورة|create an? image of|generate an? image of|draw)\s*/i, '')
    .trim() || rawPrompt.trim();

  if (skipEnhance) return clean;
  const hasReadyLlm = d.router.providerInfos().some((p) => p.status === 'ready' && p.id !== 'diagnostic');
  if (!hasReadyLlm) {
    return `${clean}, cinematic lighting, ultra detailed, sharp focus, 8k quality`;
  }

  try {
    const resolved = await d.router.resolve({ modelClass: 'chat' });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6500);
    try {
      const out = await d.router.complete(
        {
          modelId: resolved.model.id,
          stream: false,
          maxTokens: 90,
          temperature: 0.5,
          signal: ac.signal,
          messages: [
            {
              role: 'system',
              content:
                'Convert the user request into ONE vivid, concise English image generation prompt (max 35 words). Output ONLY the English prompt with no quotes or explanation.',
            },
            { role: 'user', content: clean },
          ],
        },
        {},
        'chat',
      );
      const candidate = out.text.replace(/^["'`]+|["'`]+$/g, '').trim();
      if (candidate.length >= 8) return candidate;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Graceful fallback if rate-limited or offline
  }
  return `${clean}, cinematic lighting, high detail, photorealistic`;
}

export async function generateCloudImage(
  d: AppDeps,
  opts: {
    prompt: string;
    width?: number;
    height?: number;
    conversationId?: string | null;
    projectId?: string | null;
    skipEnhance?: boolean;
    signal?: AbortSignal;
  },
): Promise<StudioImageResponse> {
  const width = opts.width ?? 1024;
  const height = opts.height ?? 1024;
  const promptUsed = await refineVisualPrompt(d, opts.prompt, opts.skipEnhance);

  let imageBytes: Uint8Array | null = null;
  let mime = 'image/jpeg';
  let provider = 'pollinations-sana';

  // 1. Try Cloudflare Workers AI (@cf/black-forest-labs/flux-1-schnell — Free 10k neurons/day) when in Workers runtime
  if (d.cfg.runtime === 'workers' && d.env.AI) {
    try {
      const ai = d.env.AI as { run(model: string, params: Record<string, unknown>): Promise<unknown> };
      const raw = await ai.run('@cf/black-forest-labs/flux-1-schnell', {
        prompt: truncate(promptUsed, 900),
        num_steps: 4,
      });
      if (raw && typeof raw === 'object' && 'image' in (raw as Record<string, unknown>) && typeof (raw as { image?: unknown }).image === 'string') {
        imageBytes = base64ToBytes((raw as { image: string }).image);
        mime = 'image/jpeg';
        provider = 'workers-ai-flux';
      } else if (raw instanceof Uint8Array) {
        imageBytes = raw;
        mime = 'image/png';
        provider = 'workers-ai-flux';
      } else if (raw && typeof (raw as ReadableStream<Uint8Array>).getReader === 'function') {
        imageBytes = await streamToBytes(raw as ReadableStream<Uint8Array>);
        mime = 'image/png';
        provider = 'workers-ai-flux';
      }
    } catch (err) {
      d.log.warn('Workers AI Flux generation fell back to Pollinations cloud GPU', { error: String(err) });
    }
  }

  // 2. Cloud GPU fallback / Desktop default: Pollinations (NVIDIA Sana — 100% free, zero API key)
  if (!imageBytes || imageBytes.byteLength < 256) {
    const seed = Math.floor(Math.random() * 999_999) + 1;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(truncate(promptUsed, 500))}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 28_000);
      try {
        const resp = await fetch(url, {
          headers: { Accept: 'image/*' },
          signal: opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal,
        });
        if (resp.ok) {
          const buf = new Uint8Array(await resp.arrayBuffer());
          if (buf.byteLength > 256) {
            imageBytes = buf;
            mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
            provider = 'cloud-sana-free';
            break;
          }
        }
        lastErr = `HTTP ${resp.status}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!imageBytes || imageBytes.byteLength < 256) {
      throw new HttpError(502, `تعذّر توليد الصورة من السحابة المجانية حالياً (${lastErr}). حاول مرة أخرى بعد لحظات.`, 'image_generation_failed');
    }
  }

  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const id = newId('att');
  const fileName = `nova-image-${id.slice(-6)}.${ext}`;
  const blobKey = `studio/${id}/${fileName}`;
  await d.blob.put(blobKey, imageBytes, { contentType: mime });

  const record = await d.store.createAttachment({
    id,
    conversationId: opts.conversationId ?? null,
    projectId: opts.projectId ?? null,
    name: fileName,
    mime,
    sizeBytes: imageBytes.byteLength,
    blobKey,
    textExcerpt: `[Generated AI Image: ${promptUsed}]`,
  });

  const attachment = {
    id: record.id,
    name: record.name,
    mime: record.mime,
    size: record.size,
    url: record.url,
  };
  const markdown = `![${opts.prompt.replace(/[\[\]\r\n]+/g, ' ').trim()}](${attachment.url})\n\n> 🎨 **الوصف البصري:** \`${promptUsed}\``;

  return { attachment, promptUsed, provider, markdown };
}

interface PlannedVideo {
  title: string;
  scenes: { caption: string; visualPrompt: string }[];
}

async function planVideoStoryboard(d: AppDeps, rawPrompt: string, isAr: boolean): Promise<PlannedVideo> {
  const clean = rawPrompt
    .replace(/^(انشئ فيديو|أنشئ فيديو|صمم فيديو|اصنع فيديو|ولد فيديو|ولّد فيديو|سوي فيديو|ابغى فيديو|أريد فيديو|create a video|generate a video|make a video)\s*(عن|حول|لـ|about|of|for)?\s*/i, '')
    .trim() || rawPrompt.trim();

  const hasReadyLlm = d.router.providerInfos().some((p) => p.status === 'ready' && p.id !== 'diagnostic');
  if (hasReadyLlm) {
    try {
      const resolved = await d.router.resolve({ modelClass: 'chat' });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 9000);
      try {
        const out = await d.router.complete(
          {
            modelId: resolved.model.id,
            stream: false,
            maxTokens: 420,
            temperature: 0.6,
            signal: ac.signal,
            messages: [
              {
                role: 'system',
                content:
                  `You are a film director creating a 4-scene AI video storyboard. Respond with STRICT JSON ONLY (no markdown fences): ` +
                  `{"title":"...","scenes":[{"caption":"...","visualPrompt":"..."}]} with exactly 4 scenes. ` +
                  `Write "title" and each "caption" (1 short engaging sentence, max 14 words) in ${isAr ? 'Arabic' : 'English'}. ` +
                  `Write each "visualPrompt" in vivid cinematic English (20-30 words, widescreen 16:9 composition, no text in image).`,
              },
              { role: 'user', content: clean },
            ],
          },
          {},
          'chat',
        );
        const jsonMatch = out.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Partial<PlannedVideo>;
          if (Array.isArray(parsed.scenes) && parsed.scenes.length >= 2) {
            return {
              title: (parsed.title || clean).slice(0, 80),
              scenes: parsed.scenes.slice(0, 4).map((s) => ({
                caption: String(s.caption || clean).slice(0, 140),
                visualPrompt: String(s.visualPrompt || `${clean}, cinematic widescreen shot`),
              })),
            };
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Fall back to deterministic storyboard below
    }
  }

  return {
    title: clean.slice(0, 70),
    scenes: isAr
      ? [
          { caption: `مشهد افتتاحي: ${clean}`, visualPrompt: `Wide cinematic establishing shot of ${clean}, golden hour lighting, dramatic atmosphere, ultra detailed 16:9` },
          { caption: `تفاصيل المشهد عن قرب بزاوية سينمائية`, visualPrompt: `Detailed close-up cinematic shot of ${clean}, shallow depth of field, rich textures, volumetric light` },
          { caption: `حركة ديناميكية وإضاءة احترافية`, visualPrompt: `Dynamic tracking angle of ${clean}, vibrant atmosphere, dramatic perspective, film grain, 8k` },
          { caption: `المشهد الختامي البانورامي`, visualPrompt: `Epic panoramic finale shot of ${clean}, breathtaking horizon, cinematic color grading, masterpiece` },
        ]
      : [
          { caption: `Opening scene: ${clean}`, visualPrompt: `Wide cinematic establishing shot of ${clean}, golden hour lighting, dramatic atmosphere, ultra detailed 16:9` },
          { caption: `Intricate details up close`, visualPrompt: `Detailed close-up cinematic shot of ${clean}, shallow depth of field, rich textures, volumetric light` },
          { caption: `Dynamic motion and perspective`, visualPrompt: `Dynamic tracking angle of ${clean}, vibrant atmosphere, dramatic perspective, film grain, 8k` },
          { caption: `Grand panoramic finale`, visualPrompt: `Epic panoramic finale shot of ${clean}, breathtaking horizon, cinematic color grading, masterpiece` },
        ],
  };
}

export async function generateCloudVideo(
  d: AppDeps,
  opts: {
    prompt: string;
    locale?: 'ar' | 'en';
    conversationId?: string | null;
    projectId?: string | null;
    signal?: AbortSignal;
  },
): Promise<StudioVideoResponse> {
  const isAr = opts.locale ? opts.locale === 'ar' : hasArabic(opts.prompt);
  const plan = await planVideoStoryboard(d, opts.prompt, isAr);

  const generated = await Promise.all(
    plan.scenes.map(async (scene, idx) => {
      const img = await generateCloudImage(d, {
        prompt: scene.visualPrompt,
        width: 768,
        height: 448,
        conversationId: opts.conversationId,
        projectId: opts.projectId,
        skipEnhance: true,
        signal: opts.signal,
      });
      return {
        imageUrl: img.attachment.url,
        attachmentId: img.attachment.id,
        caption: scene.caption,
        durationSec: 3.5,
        motion: MOTIONS[idx % MOTIONS.length],
        provider: img.provider,
      };
    }),
  );

  const provider = generated[0]?.provider ?? 'cloud-sana-free';
  const scenes: StudioVideoScene[] = generated.map(({ provider: _p, ...rest }) => rest);
  const payload = JSON.stringify({ title: plan.title, lang: isAr ? 'ar' : 'en', scenes });
  const markdown = `\`\`\`nova-video\n${payload}\n\`\`\``;

  return { title: plan.title, scenes, provider, markdown };
}

export function detectStudioIntent(message: string, explicitMode?: string): 'image' | 'video' | 'website' | null {
  if (explicitMode === 'image' || explicitMode === 'video' || explicitMode === 'website') {
    return explicitMode;
  }
  const m = message.trim();
  if (/^(ارسم|انشئ صورة|أنشئ صورة|ولد صورة|ولّد صورة|صمم صورة|ابغى صورة|أريد صورة|سوي صورة|اصنع صورة|create an? image|generate an? image|draw\s)/i.test(m)) {
    return 'image';
  }
  if (/^(انشئ فيديو|أنشئ فيديو|صمم فيديو|اصنع فيديو|ولد فيديو|ولّد فيديو|سوي فيديو|ابغى فيديو|أريد فيديو|اعمل فيديو|create a video|generate a video|make a video)/i.test(m)) {
    return 'video';
  }
  if (/^(صمم موقع|انشئ موقع|أنشئ موقع|سوي موقع|ابني موقع|اصنع موقع|اريد موقع|أريد موقع|ابغى موقع|صمم صفحة ويب|صمم متجر|build a website|create a website|design a website|make a landing page)/i.test(m)) {
    return 'website';
  }
  return null;
}
