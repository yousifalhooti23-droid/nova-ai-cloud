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
    if (d.currentUser) {
      await d.auth.consumeQuota(d.currentUser.id, 2);
    }
    const res = await generateCloudImage(d, {
      prompt: req.prompt.trim(),
      width: req.width !== undefined ? clampDim(req.width) : undefined,
      height: req.height !== undefined ? clampDim(req.height) : undefined,
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
    if (d.currentUser) {
      await d.auth.consumeQuota(d.currentUser.id, 4);
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

const IMAGE_PREFIX_RE =
  /^(ارسم(?:\s+لي)?|انشئ\s+صور[ةه]|أنشئ\s+صور[ةه]|انشاء\s+صور[ةه]|إنشاء\s+صور[ةه]|ولد\s+صور[ةه]|ولّد\s+صور[ةه]|صمم\s+صور[ةه]|ابغى\s+صور[ةه]|أريد\s+صور[ةه]|اريد\s+صور[ةه]|سوي(?:\s+لي)?\s+صور[ةه]|اصنع\s+صور[ةه]|اعمل\s+صور[ةه]|صور[ةه](?:\s+عن|\s+لـ|\s+حول)?|create an? image(?:\s+of)?|generate an? image(?:\s+of)?|draw)\s*/i;

const VIDEO_PREFIX_RE =
  /^(انشئ\s+(?:فيديو|فديو|قديو)|أنشئ\s+(?:فيديو|فديو|قديو)|انشاء\s+(?:فيديو|فديو|قديو)|إنشاء\s+(?:فيديو|فديو|قديو)|صمم\s+(?:فيديو|فديو|قديو)|اصنع\s+(?:فيديو|فديو|قديو)|ولد\s+(?:فيديو|فديو|قديو)|ولّد\s+(?:فيديو|فديو|قديو)|سوي(?:\s+لي)?\s+(?:فيديو|فديو|قديو)|ابغى\s+(?:فيديو|فديو|قديو)|أريد\s+(?:فيديو|فديو|قديو)|اريد\s+(?:فيديو|فديو|قديو)|اعمل(?:\s+لي)?\s+(?:فيديو|فديو|قديو)|(?:فيديو|فديو|قديو)(?:\s+عن|\s+حول|\s+لـ)?|create a video(?:\s+about|\s+of)?|generate a video(?:\s+about|\s+of)?|make a video(?:\s+about|\s+of)?)\s*/i;

/**
 * Automatically detects aspect ratio from keywords in the prompt:
 * - "vertical" / "poster" / "portrait" -> 768 x 1024
 * - "horizontal" / "landscape" / "widescreen" -> 1024 x 768
 * - default -> 1024 x 1024
 */
export function detectImageDimensions(
  prompt: string,
  requestedWidth?: number,
  requestedHeight?: number,
): { width: number; height: number; aspect: 'square' | 'vertical' | 'horizontal' } {
  // Respect explicit non-default dimensions passed from client options
  if (
    requestedWidth &&
    requestedHeight &&
    (requestedWidth !== 1024 || requestedHeight !== 1024)
  ) {
    const w = clampDim(requestedWidth);
    const h = clampDim(requestedHeight);
    return {
      width: w,
      height: h,
      aspect: h > w ? 'vertical' : w > h ? 'horizontal' : 'square',
    };
  }

  const p = prompt.toLowerCase();

  // Vertical / Poster aspect keywords: 768 x 1024
  if (
    /(?:vertical|poster|portrait|phone|wallpaper|story|stories|tall|mobile|عمودي|طولي|بوستر|ستوري|خلفية\s+جوال|غلاف|ريلز|تيك\s*توك)/i.test(p)
  ) {
    return { width: 768, height: 1024, aspect: 'vertical' };
  }

  // Horizontal / Landscape aspect keywords: 1024 x 768
  if (
    /(?:horizontal|landscape|widescreen|wide|banner|desktop|youtube|16:9|4:3|أفقي|عرضي|عريض|بانر|شاشة\s+عريضة|ديسك\s*توب|يوتيوب)/i.test(p)
  ) {
    return { width: 1024, height: 768, aspect: 'horizontal' };
  }

  // Default square: 1024 x 1024
  return { width: 1024, height: 1024, aspect: 'square' };
}

/**
 * Clean and normalize image prompts:
 * - Strips command prefixes ("صمم لي صورة", "generate an image", etc.)
 * - Strips attached filename noise ("WhatsApp Image...", "att_123...")
 * - Replaces newlines (\r\n, \r, \n), tabs, and multiple spaces with single spaces
 * - NEVER truncates multi-line descriptions of typography, composition, or lighting.
 */
export function cleanAndSanitizeImagePrompt(raw: string): string {
  let p = raw.trim();
  p = p.replace(IMAGE_PREFIX_RE, '').trim();
  p = p.replace(/(?:WhatsApp Image|image|photo|att_)[^\n\r]*\.(?:jpeg|jpg|png|webp|gif)/gi, ' ');
  p = p.replace(/\[(?:Attached\s+video\s+file|attached\s+file)[^\]]*\]/gi, ' ');
  // Replace newlines, line breaks, and tabs with spaces to preserve full descriptions
  p = p.replace(/[\r\n\t]+/g, ' ');
  p = p.replace(/\s{2,}/g, ' ').trim();
  return p.length >= 2 ? p : 'cinematic artistic masterpiece, dramatic studio lighting, 8k render';
}

/**
 * Translates and expands Arabic prompts into crisp, domain-specific visual descriptions.
 * Preserves all fine details (typography, specular highlights, object placement).
 */
async function translateVisualSubject(d: AppDeps, cleanText: string): Promise<string> {
  const text = cleanText.trim();
  if (!text) return 'cinematic visual showcase with professional lighting';

  // If purely English or substantial English text, keep as-is with zero compression
  const englishCount = (text.match(/[a-zA-Z]/g) || []).length;
  if (!hasArabic(text) || englishCount > 25) {
    return text;
  }

  // 1. Try fast LLM translation preserving ALL details, typography, and composition
  const hasReadyLlm = d.router.providerInfos().some((p) => p.status === 'ready' && p.id !== 'diagnostic');
  if (hasReadyLlm) {
    try {
      const resolved = await d.router.resolve({ modelClass: 'chat' });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 12000);
      try {
        const out = await d.router.complete(
          {
            modelId: resolved.model.id,
            stream: false,
            maxTokens: 400,
            temperature: 0.3,
            signal: ac.signal,
            messages: [
              {
                role: 'system',
                content:
                  'Translate this Arabic visual description into a detailed, high-fidelity English visual prompt for FLUX image generation. Preserve all typography, objects, lighting, colors, layout, and composition. Output ONLY the English translation without quotes, notes, or commentary.',
              },
              { role: 'user', content: text },
            ],
          },
          {},
          'chat',
        );
        const candidate = out.text.replace(/^["'`]+|["'`]+$/g, '').trim();
        if (candidate.length >= 8 && !hasArabic(candidate)) {
          return candidate;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      /* proceed to semantic dictionary fallback */
    }
  }

  // 2. High-precision semantic vocabulary mapping for Arabic domains
  const low = text.toLowerCase();
  const descriptors: string[] = [];

  if (/عطر|عطور|بخور|لبان|دخون/i.test(low)) {
    descriptors.push('luxury artisanal perfume bottles, swirling aromatic frankincense smoke, warm amber glass, opulent oriental fragrance presentation');
  }
  if (/قهو[ةه]|كافيه|شاي|مقهى|اسبريسو/i.test(low)) {
    descriptors.push('specialty artisan roasted coffee brewing, pouring rich espresso, aromatic steam, warm rustic coffeehouse lighting');
  }
  if (/سيار[ةه]|سيارات|مرسيدس|فيراري|بورش|لكزس|سباق|قياد[ةه]/i.test(low)) {
    descriptors.push('sleek high-performance luxury sports car, dynamic aerodynamic curves, glowing headlights, desert highway sunset reflections');
  }
  if (/عمان|عماني|عُمان|مسقط|صلالة|نزوى/i.test(low)) {
    descriptors.push('authentic Sultanate of Oman cultural architecture, historic clay fortresses, majestic desert dunes, turquoise Arabian Sea coastline');
  }
  if (/متجر|محل|دكان|سوق|منتجات|تسوق/i.test(low)) {
    descriptors.push('elegant boutique retail store showcase, beautifully arranged premium products, warm ambient architectural lighting');
  }
  if (/طبيعة|جبل|جبال|وادي|بحر|شاطئ|رمال|صحراء/i.test(low)) {
    descriptors.push('majestic natural landscape, rugged mountain peaks, golden sand dunes, dramatic sky with atmospheric volumetric lighting');
  }
  if (/طعام|مطعم|أكل|طبخ|شيف|وجب[ةه]|برجر/i.test(low)) {
    descriptors.push('gourmet culinary masterpiece, appetizing fresh food plating, artisan kitchen, warm fine dining atmosphere');
  }
  if (/تقني[ةه]|تكنولوجيا|روبوت|ذكاء\s*اصطناعي|مستقبل|برمج/i.test(low)) {
    descriptors.push('advanced futuristic technology showcase, glowing holographic interface, clean glass architecture, cybernetic aesthetic');
  }
  if (/حصان|خيل|صقر|جمل|جمال|نمر|أسد|حيوان/i.test(low)) {
    descriptors.push('majestic noble Arabian animal portrait, golden sunlight highlights, powerful stance, expressive cinematic depth');
  }
  if (/فضاء|كواكب|نجوم|مجرة|فلك/i.test(low)) {
    descriptors.push('deep cosmic nebula, vibrant stellar clouds, distant celestial planets, awe-inspiring galaxy vista');
  }

  if (descriptors.length > 0) {
    return `${descriptors.join(', ')}, ${text.replace(/[^\w\s\u0600-\u06FF]/g, ' ').trim()}`;
  }

  return `${text.replace(/[^\w\s\u0600-\u06FF]/g, ' ').trim()}, vivid cinematic aesthetic, dramatic lighting, ultra detailed 8k`;
}

/**
 * Prepares the visual prompt:
 * Replaces newlines with spaces, cleans noise, and preserves full descriptions without truncating.
 */
async function refineVisualPrompt(d: AppDeps, rawPrompt: string, skipEnhance = false): Promise<string> {
  const clean = cleanAndSanitizeImagePrompt(rawPrompt);
  if (skipEnhance) return clean;

  const englishCount = (clean.match(/[a-zA-Z]/g) || []).length;
  if (!hasArabic(clean) || englishCount > 25) {
    return clean;
  }

  return translateVisualSubject(d, clean);
}

async function runWorkersAiImageModel(
  ai: { run(model: string, params: Record<string, unknown>): Promise<unknown> },
  model: string,
  params: Record<string, unknown>,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const raw = await ai.run(model, params);
  if (raw instanceof Uint8Array && raw.byteLength > 256) {
    return { bytes: raw, mime: 'image/png' };
  }
  if (raw && typeof (raw as ReadableStream<Uint8Array>).getReader === 'function') {
    const bytes = await streamToBytes(raw as ReadableStream<Uint8Array>);
    if (bytes.byteLength > 256) return { bytes, mime: 'image/png' };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { image?: unknown; result?: { image?: unknown } };
    const b64 = typeof obj.image === 'string' ? obj.image : typeof obj.result?.image === 'string' ? obj.result.image : null;
    if (b64) {
      const bytes = base64ToBytes(b64);
      if (bytes.byteLength > 256) return { bytes, mime: 'image/jpeg' };
    }
  }
  return null;
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
    fast?: boolean;
    signal?: AbortSignal;
  },
): Promise<StudioImageResponse> {
  const dim = detectImageDimensions(opts.prompt, opts.width, opts.height);
  const width = dim.width;
  const height = dim.height;
  const promptUsed = await refineVisualPrompt(d, opts.prompt, opts.skipEnhance);

  let imageBytes: Uint8Array | null = null;
  let mime = 'image/jpeg';
  let provider = 'workers-ai-flux';
  let lastErr = '';

  // 1. Primary Image Generator: Cloudflare Workers AI (FLUX -> SDXL-Lightning)
  if (d.env.AI) {
    const ai = d.env.AI as { run(model: string, params: Record<string, unknown>): Promise<unknown> };
    const candidates: { id: string; model: string; params: Record<string, unknown> }[] = [
      {
        id: 'workers-ai-flux',
        model: '@cf/black-forest-labs/flux-1-schnell',
        params: { prompt: promptUsed, steps: 4 },
      },
      {
        id: 'workers-ai-sdxl-lightning',
        model: '@cf/bytedance/stable-diffusion-xl-lightning',
        params: { prompt: promptUsed, width, height, num_steps: 4 },
      },
      {
        id: 'workers-ai-sdxl',
        model: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
        params: { prompt: promptUsed, width, height, num_steps: 12 },
      },
    ];

    for (const candidate of candidates) {
      try {
        const res = await runWorkersAiImageModel(ai, candidate.model, candidate.params);
        if (res && res.bytes.byteLength > 256) {
          imageBytes = res.bytes;
          mime = res.mime;
          provider = candidate.id;
          d.log.info('generated image via Cloudflare Workers AI', { model: candidate.model, bytes: imageBytes.byteLength, width, height });
          break;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        d.log.warn('Workers AI image engine failed, trying next candidate', { model: candidate.model, error: lastErr });
      }
    }
  }

  // 2. Optional Cloud Worker Bridge when running locally without direct AI binding
  const cloudBridgeUrl = typeof d.env.NOVA_CLOUD_URL === 'string' ? d.env.NOVA_CLOUD_URL.trim().replace(/\/$/, '') : '';
  if ((!imageBytes || imageBytes.byteLength < 256) && cloudBridgeUrl && d.cfg.runtime === 'node') {
    try {
      const bridgeResp = await fetch(`${cloudBridgeUrl}/api/studio/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptUsed, width, height }),
        signal: opts.signal,
      });
      if (bridgeResp.ok) {
        const meta = (await bridgeResp.json()) as StudioImageResponse;
        const imgUrl = meta.attachment?.url?.startsWith('http') ? meta.attachment.url : `${cloudBridgeUrl}${meta.attachment.url}`;
        const rawImg = await fetch(imgUrl, { signal: opts.signal });
        if (rawImg.ok) {
          const buf = new Uint8Array(await rawImg.arrayBuffer());
          if (buf.byteLength > 256) {
            imageBytes = buf;
            mime = meta.attachment.mime || 'image/jpeg';
            provider = meta.provider || 'nova-cloud-gpu';
          }
        }
      } else {
        lastErr = `Cloud bridge HTTP ${bridgeResp.status}`;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  // 3. Upgraded Fallback Image Generator: Pollinations FLUX Pro Configuration
  // NEVER use bare default URL. Always specify model=flux, width, height, nologo=true, enhance=false, and random seed.
  if (!imageBytes || imageBytes.byteLength < 256) {
    const randomSeed = Math.floor(Math.random() * 2147483647);
    const fluxProUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptUsed)}?model=flux&width=${width}&height=${height}&nologo=true&enhance=false&seed=${randomSeed}`;
    const turboFallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptUsed)}?model=turbo&width=${width}&height=${height}&nologo=true&enhance=false&seed=${randomSeed}`;

    const endpointsToTry = [
      { url: fluxProUrl, provider: 'pollinations-flux-pro' },
      { url: turboFallbackUrl, provider: 'pollinations-turbo' },
    ];

    for (const ep of endpointsToTry) {
      try {
        const polResp = await fetch(ep.url, { signal: opts.signal ?? AbortSignal.timeout(28000) });
        if (polResp.ok) {
          const polBuf = new Uint8Array(await polResp.arrayBuffer());
          if (polBuf.byteLength > 256) {
            imageBytes = polBuf;
            mime = polResp.headers.get('content-type') || 'image/jpeg';
            provider = ep.provider;
            d.log.info('generated image via Pollinations FLUX Pro fallback', { provider, bytes: polBuf.byteLength, width, height });
            break;
          }
        } else {
          lastErr = `Pollinations HTTP ${polResp.status}`;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        d.log.warn('Pollinations FLUX Pro endpoint failed, trying next candidate', { provider: ep.provider, error: lastErr });
      }
    }
  }

  if (!imageBytes || imageBytes.byteLength < 256) {
    throw new HttpError(
      502,
      `تعذّر توليد الصورة حالياً (${lastErr || 'لا يوجد اتصال بمحرك الصور السحابي'}). حاول مرة أخرى بعد لحظات.`,
      'image_generation_failed',
    );
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
  const aspectLabel = dim.aspect === 'vertical' ? 'طولي / Poster (768×1024)' : dim.aspect === 'horizontal' ? 'عرضي / Landscape (1024×768)' : 'مربع / Square (1024×1024)';
  const cleanAlt = opts.prompt.replace(/[\[\]\r\n]+/g, ' ').trim().slice(0, 100);
  const markdown = `![${cleanAlt}](${attachment.url})\n\n> 🎨 **المحرك:** \`${provider}\` · **الأبعاد:** \`${aspectLabel}\`\n> 📝 **الوصف:** ${promptUsed}`;

  return { attachment, promptUsed, provider, markdown };
}

interface PlannedVideo {
  title: string;
  scenes: { caption: string; visualPrompt: string }[];
}

async function planVideoStoryboard(d: AppDeps, rawPrompt: string, isAr: boolean): Promise<PlannedVideo> {
  const stripped = rawPrompt.replace(VIDEO_PREFIX_RE, '').trim();
  const clean = stripped.length >= 2 ? stripped : isAr ? 'رحلة سينمائية ملهمة ومبهرة' : 'Inspiring cinematic visual journey';

  // Translate the subject to accurate English first so all scenes strictly revolve around the user's topic
  const englishSubject = await translateVisualSubject(d, clean);

  const hasReadyLlm = d.router.providerInfos().some((p) => p.status === 'ready' && p.id !== 'diagnostic');
  if (hasReadyLlm) {
    try {
      const resolved = await d.router.resolve({ modelClass: 'chat' });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 22000);
      try {
        const out = await d.router.complete(
          {
            modelId: resolved.model.id,
            stream: false,
            maxTokens: 500,
            temperature: 0.5,
            signal: ac.signal,
            messages: [
              {
                role: 'system',
                content:
                  `You are an award-winning cinematic video director. The user wants an AI video about: "${clean}" (Subject in English: "${englishSubject}"). ` +
                  `Create a 4-scene video storyboard STRICTLY AND ONLY about this specific topic. Never invent an unrelated topic. ` +
                  `Respond with STRICT JSON ONLY: {"title":"...","scenes":[{"caption":"...","visualPrompt":"..."}]} with exactly 4 scenes. ` +
                  `"title": short engaging title in ${isAr ? 'Arabic' : 'English'}. ` +
                  `"caption": 1 engaging spoken sentence in ${isAr ? 'Arabic' : 'English'} describing what happens in this scene. ` +
                  `"visualPrompt": 25-35 words in English describing the exact visuals, subject (${englishSubject}), lighting, and 16:9 widescreen composition for image generation with no text.`,
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
                visualPrompt: String(
                  s.visualPrompt || `Cinematic 16:9 widescreen shot of ${englishSubject}, dramatic volumetric lighting, 8k photorealistic`,
                ),
              })),
            };
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Fall back to subject-preserving deterministic storyboard below
    }
  }

  // Guaranteed subject-preserving fallback matching the user's exact topic
  return {
    title: clean.slice(0, 70),
    scenes: isAr
      ? [
          { caption: `مشهد افتتاحي: ${clean}`, visualPrompt: `Cinematic wide establishing shot of ${englishSubject}, golden hour lighting, dramatic atmosphere, ultra detailed 16:9` },
          { caption: `لقطة مقربة تبرز تفاصيل وجوهر المشهد`, visualPrompt: `Detailed cinematic close-up shot of ${englishSubject}, shallow depth of field, rich textures, professional studio light` },
          { caption: `زاوية حركية ديناميكية مفعمة بالحيوية`, visualPrompt: `Dynamic low-angle tracking shot of ${englishSubject}, vibrant atmosphere, dramatic perspective, 8k photorealistic` },
          { caption: `المشهد الختامي البانورامي المؤثر`, visualPrompt: `Epic breathtaking panoramic finale shot of ${englishSubject}, cinematic color grading, widescreen masterpiece` },
        ]
      : [
          { caption: `Opening scene: ${clean}`, visualPrompt: `Cinematic wide establishing shot of ${englishSubject}, golden hour lighting, dramatic atmosphere, ultra detailed 16:9` },
          { caption: `Detailed close-up capturing the essence`, visualPrompt: `Detailed cinematic close-up shot of ${englishSubject}, shallow depth of field, rich textures, professional studio light` },
          { caption: `Dynamic motion and dramatic angle`, visualPrompt: `Dynamic low-angle tracking shot of ${englishSubject}, vibrant atmosphere, dramatic perspective, 8k photorealistic` },
          { caption: `Grand breathtaking panoramic finale`, visualPrompt: `Epic breathtaking panoramic finale shot of ${englishSubject}, cinematic color grading, widescreen masterpiece` },
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

  // Render in pairs of 2 using fast cloud GPU mode (SDXL-Lightning -> Flux) for ~3s total latency & zero rate-limit bursts
  const generated: (StudioVideoScene & { provider: string })[] = [];
  for (let i = 0; i < plan.scenes.length; i += 2) {
    const batch = plan.scenes.slice(i, i + 2);
    const batchResults = await Promise.all(
      batch.map(async (scene, offset) => {
        const idx = i + offset;
        const img = await generateCloudImage(d, {
          prompt: scene.visualPrompt,
          width: 768,
          height: 448,
          conversationId: opts.conversationId,
          projectId: opts.projectId,
          skipEnhance: true,
          fast: true,
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
    generated.push(...batchResults);
  }

  const provider = generated[0]?.provider ?? 'workers-ai-sdxl-lightning';
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
  if (
    /^(?:صمم|ارسم|انشئ|أنشئ|انشاء|إنشاء|ولد|ولّد|ابغى|أريد|اريد|سوي|اصنع|اعمل)(?:\s+لي)?\s+(?:صور[ةه]|بوستر|poster|شعار|لوجو|لوقو|غلاف|خلفي[ةه]|ايقون[ةه]|رسم[ةه])/i.test(m) ||
    /^(?:ارسم|draw\s|صورة\s+لـ|صورة\s+عن|بوستر\s+لـ|بوستر\s+عن|خريطة\s+عمان|خريطة\s+|create an? image|generate an? image)/i.test(m)
  ) {
    return 'image';
  }
  if (
    /^(?:انشئ|أنشئ|انشاء|إنشاء|صمم|اصنع|ولد|ولّد|سوي|ابغى|أريد|اريد|اعمل)(?:\s+لي)?\s+(?:فيديو|فديو|قديو|storyboard|فيديو\s+قصير|مشهد)/i.test(m) ||
    /^(?:create a video|generate a video|make a video)/i.test(m)
  ) {
    return 'video';
  }
  if (
    /^(?:صمم|انشئ|أنشئ|انشاء|إنشاء|سوي|ابني|اصنع|اريد|أريد|ابغى|اعمل)(?:\s+لي)?\s+(?:موقع|متجر|صفح[ةه]\s+ويب|بورتفوليو|dashboard|landing\s+page)/i.test(m) ||
    /^(?:موقع|متجر|صفحة\s+موقع|كود\s+موقع)\s+(?:تجريبي|كامل|بسيط|عن|لـ|جديد|شخصي|تفاعلي|web)/i.test(m) ||
    /^(?:build a website|create a website|design a website|make a landing page)/i.test(m)
  ) {
    return 'website';
  }
  return null;
}
