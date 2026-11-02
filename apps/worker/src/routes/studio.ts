import type {
  StudioImageRequest,
  StudioImageResponse,
} from '@nova/shared';
import { newId } from '@nova/shared';
import type { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context.js';
import { badRequest, HttpError } from '../lib/errors.js';
import {
  detectVisualArchetype,
  detectVisualDimensions,
  buildMasterVisualPrompt,
  extractCleanSubject,
  type VisualArchetype,
} from '../ai/visual-director.js';

export { detectVisualDimensions as detectImageDimensions };

/**
 * Free Cloud Creative Studio routes:
 * - POST /api/studio/image -> 100% free cloud GPU image generation with Visual Director (Workers AI Flux -> Pollinations Flux Pro)
 * Note: Video generation has been completely removed to prevent useless server load and quota exhaustion.
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
  /^(ارسم(?:\s+لي)?|انشئ\s+صور[ةه]|أنشئ\s+صور[ةه]|انشاء\s+صور[ةه]|إنشاء\s+صور[ةه]|ولد\s+صور[ةه]|ولّد\s+صور[ةه]|صمم\s+صور[ةه]|صمم\s+بوستر|ابغى\s+صور[ةه]|أريد\s+صور[ةه]|اريد\s+صور[ةه]|سوي(?:\s+لي)?\s+صور[ةه]|اصنع\s+صور[ةه]|اعمل\s+صور[ةه]|صور[ةه](?:\s+عن|\s+لـ|\s+حول)?|create an? image(?:\s+of)?|generate an? image(?:\s+of)?|draw)\s*/i;

/**
 * Clean and normalize image prompts:
 * - Strips command prefixes
 * - Strips attached filename noise
 * - Replaces newlines (\r\n, \r, \n) and tabs with spaces to preserve full descriptions
 */
export function cleanAndSanitizeImagePrompt(raw: string): string {
  let p = raw.trim();
  p = p.replace(IMAGE_PREFIX_RE, '').trim();
  p = p.replace(/(?:WhatsApp Image|image|photo|att_)[^\n\r]*\.(?:jpeg|jpg|png|webp|gif)/gi, ' ');
  p = p.replace(/\[(?:Attached\s+file|attached)[^\]]*\]/gi, ' ');
  p = p.replace(/[\r\n\t]+/g, ' ');
  p = p.replace(/\s{2,}/g, ' ').trim();
  return p.length >= 2 ? p : 'cinematic artistic masterpiece, dramatic studio lighting, 8k render';
}

/**
 * Translates and expands Arabic visual subjects into crisp, domain-specific visual descriptions.
 * Preserves all fine details (typography, specular highlights, object placement).
 */
async function translateVisualSubject(d: AppDeps, cleanText: string): Promise<string> {
  const text = cleanText.trim();
  if (!text) return 'cinematic visual showcase with professional lighting';

  // If purely English with no Arabic, keep as-is with zero compression
  if (!hasArabic(text)) {
    return text;
  }

  // 1. Fast LLM translation preserving ALL details, typography, and composition
  const hasReadyLlm = d.router.providerInfos().some((p) => p.status === 'ready' && p.id !== 'diagnostic');
  if (hasReadyLlm) {
    try {
      const resolved = await d.router.resolve({ modelClass: 'chat' });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10000);
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
                  'Translate this Arabic visual description into a detailed, high-fidelity English visual subject for FLUX image generation. Preserve all typography names, brand names, objects, lighting, colors, layout, and composition. Output ONLY the English translation without quotes, notes, or commentary.',
              },
              { role: 'user', content: text },
            ],
          },
          {},
          'chat',
        );
        const candidate = out.text.replace(/^["'`]+|["'`]+$/g, '').trim();
        if (candidate.length >= 5 && !hasArabic(candidate)) {
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
  if (/سوني|بلايستيشن|playstation|يد\s+تحكم/i.test(low)) {
    descriptors.push('official Sony PlayStation 5 DualSense wireless controller, sleek ergonomic industrial design, illuminated LED accents, clean geometric pedestal');
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
  if (/طبيعة|جبل|جبال|وادي|بحر|شاطئ|رمال|صحراء/i.test(low)) {
    descriptors.push('majestic natural landscape, rugged mountain peaks, golden sand dunes, dramatic sky with atmospheric volumetric lighting');
  }
  if (/طعام|مطعم|أكل|طبخ|شيف|وجب[ةه]|برجر/i.test(low)) {
    descriptors.push('gourmet culinary masterpiece, appetizing fresh food plating, artisan kitchen, warm fine dining atmosphere');
  }
  if (/فضاء|كواكب|نجوم|مجرة|فلك/i.test(low)) {
    descriptors.push('deep cosmic nebula, vibrant stellar clouds, distant celestial planets, awe-inspiring galaxy vista');
  }

  if (descriptors.length > 0) {
    return `${descriptors.join(', ')}, ${text.replace(/[^\w\s\u0600-\u06FF]/g, ' ').trim()}`;
  }

  return `${text.replace(/[^\w\s\u0600-\u06FF]/g, ' ').trim()}, vivid cinematic aesthetic, dramatic lighting, ultra detailed 8k`;
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
  const archetype = detectVisualArchetype(opts.prompt);
  const dim = detectVisualDimensions(opts.prompt, opts.width, opts.height);
  const width = clampDim(dim.width);
  const height = clampDim(dim.height);

  let promptUsed: string;
  let negativePrompt: string;

  if (!opts.skipEnhance) {
    let cleanSubject = extractCleanSubject(opts.prompt);
    if (hasArabic(cleanSubject)) {
      cleanSubject = await translateVisualSubject(d, cleanSubject);
    }
    const recipe = buildMasterVisualPrompt(cleanSubject, archetype, dim.aspect);
    promptUsed = recipe.prompt;
    negativePrompt = recipe.negative;
  } else {
    promptUsed = cleanAndSanitizeImagePrompt(opts.prompt);
    negativePrompt = 'blurry, deformed, low quality, artifacts';
  }

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
        params: { prompt: promptUsed, width, height, num_steps: 4, negative_prompt: negativePrompt },
      },
      {
        id: 'workers-ai-sdxl',
        model: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
        params: { prompt: promptUsed, width, height, num_steps: 12, negative_prompt: negativePrompt },
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
  if (!imageBytes || imageBytes.byteLength < 256) {
    const randomSeed = Math.floor(Math.random() * 2147483647);
    const fluxProUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptUsed)}?model=flux&width=${width}&height=${height}&nologo=true&enhance=false&seed=${randomSeed}&negative=${encodeURIComponent(negativePrompt)}`;
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

  const archetypeLabels: Record<VisualArchetype, string> = {
    graphic_poster: '🖼️ ملصق إعلاني وتصميم جرافيك (Graphic Poster)',
    photorealistic_portrait: '📸 تصوير وبورتريه واقعي (Hasselblad Realism)',
    commercial_product: '💎 استوديو منتجات تجاري (Octane 3D Studio)',
    architectural_interior: '🏛️ تصميم معماري وديكور (Architectural Digest)',
    cinematic_landscape: '🌄 مشهد سينمائي طبيعي (Cinematic 8K)',
    creative_general: '🎨 تحفة بصرية فنية (Masterpiece)',
  };

  const aspectLabel =
    dim.aspect === 'vertical'
      ? `طولي / Poster (${width}×${height})`
      : dim.aspect === 'horizontal'
        ? `عرضي / Landscape (${width}×${height})`
        : `مربع / Square (${width}×${height})`;

  const cleanAlt = opts.prompt.replace(/[\[\]\r\n]+/g, ' ').trim().slice(0, 100);
  const markdown = `![${cleanAlt}](${attachment.url})\n\n> 🎯 **النمط:** ${archetypeLabels[archetype] ?? archetype}\n> 🎨 **المحرك:** \`${provider}\` · **الأبعاد:** \`${aspectLabel}\`\n> 📝 **الوصف المعزز:** ${promptUsed}`;

  return { attachment, promptUsed, provider, markdown };
}

export function detectStudioIntent(message: string, explicitMode?: string): 'image' | 'website' | null {
  if (explicitMode === 'image' || explicitMode === 'website') {
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
    /^(?:صمم|انشئ|أنشئ|انشاء|إنشاء|سوي|ابني|اصنع|اريد|أريد|ابغى|اعمل)(?:\s+لي)?\s+(?:موقع|متجر|صفح[ةه]\s+ويب|بورتفوليو|dashboard|landing\s+page)/i.test(m) ||
    /^(?:موقع|متجر|صفحة\s+موقع|كود\s+موقع)\s+(?:تجريبي|كامل|بسيط|عن|لـ|جديد|شخصي|تفاعلي|web)/i.test(m) ||
    /^(?:build a website|create a website|design a website|make a landing page)/i.test(m)
  ) {
    return 'website';
  }
  return null;
}
