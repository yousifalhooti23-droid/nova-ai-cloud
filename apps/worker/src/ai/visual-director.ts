/**
 * NOVA AI — Visual Director & Graphic Design Studio Engine
 * =========================================================
 * Transforms raw user prompts into award-winning, hyper-realistic,
 * and commercially-grade graphic designs without draining server compute.
 *
 * Implements master design archetypes:
 * - Commercial Graphic Posters & Typography (PlayStation, Apple, Nike style)
 * - Hyperrealistic Photography & Portraits (Hasselblad 85mm raw realism)
 * - Luxury Commercial Product Showcases (Octane studio renders)
 * - Modern Architectural & Interior Editorials
 */

export type VisualArchetype =
  | 'graphic_poster'
  | 'photorealistic_portrait'
  | 'commercial_product'
  | 'architectural_interior'
  | 'cinematic_landscape'
  | 'creative_general';

export interface VisualDesignResult {
  enhancedPrompt: string;
  archetype: VisualArchetype;
  recommendedWidth: number;
  recommendedHeight: number;
  negativePrompt: string;
}

export function detectVisualArchetype(rawPrompt: string): VisualArchetype {
  const p = rawPrompt.toLowerCase();

  // 1. Graphic Poster & Advertising
  if (
    /بوستر|ملصق|شعار|لوجو|لوقو|إعلان|اعلان|تصميم\s+جرافيك|دعاية|بانر|غلاف|سوشيال\s*ميديا|سوني|بلايستيشن|playstation|dualsense|sony|poster|flyer|billboard|graphic\s+design|vector\s+art|typography/i.test(
      p,
    )
  ) {
    return 'graphic_poster';
  }

  // 2. Real Human / Photorealistic Portrait
  if (
    /شخص|إنسان|رجل|امرأة|بنت|فتاة|طفل|وجه|ملامح|صورة\s+حقيقي|شخصية\s+حقيقي|تصوير\s+فوتوغرافي|بورتريه|واقعي|portrait|human|person|woman|man|face|candid\s+photo|photorealistic\s+human|realistic\s+face/i.test(
      p,
    )
  ) {
    return 'photorealistic_portrait';
  }

  // 3. Commercial Product & Luxury Showcase
  if (
    /منتج|عطر|عطور|بخور|ساعة|سيارة|سيارات|هاتف|سماعات|حذاء|أحذية|حقيبة|قهوة|مشروب|علبة|تغليف|product\s+shot|luxury\s+watch|perfume\s+bottle|automotive|sneaker|commercial\s+photography/i.test(
      p,
    )
  ) {
    return 'commercial_product';
  }

  // 4. Architectural & Interior Design
  if (
    /غرفة|مكتب|صالة|منزل|بيت|فيلا|قصر|مبنى|عمارة|ديكور|أثاث|interior\s+design|architectural|modern\s+room|minimalist\s+house/i.test(
      p,
    )
  ) {
    return 'architectural_interior';
  }

  // 5. Cinematic Landscape & Cosmic
  if (/طبيعة|جبل|جبال|صحراء|بحر|شاطئ|فضاء|كواكب|مجرة|landscape|mountains|desert|cosmic|galaxy/i.test(p)) {
    return 'cinematic_landscape';
  }

  return 'creative_general';
}

export function detectVisualDimensions(
  prompt: string,
  userWidth?: number,
  userHeight?: number,
): { width: number; height: number; aspect: 'vertical' | 'horizontal' | 'square' } {
  if (userWidth && userHeight) {
    const aspect = userHeight > userWidth ? 'vertical' : userWidth > userHeight ? 'horizontal' : 'square';
    return { width: userWidth, height: userHeight, aspect };
  }

  const p = prompt.toLowerCase();

  // Vertical (Posters, mobile wallpapers, social stories)
  if (
    /طولي|عمودي|بوستر|ستوري|ريلز|سناب|خلفية\s+جوال|غلاف|تيك\s*توك|poster|vertical|portrait|story|wallpaper|phone\s+background/i.test(
      p,
    )
  ) {
    return { width: 768, height: 1024, aspect: 'vertical' };
  }

  // Horizontal (Banners, cinematic desktop wallpaper, wide landscape)
  if (
    /عرضي|أفقي|بانوراما|سينمائي|غلاف\s+يوتيوب|خلفية\s+كمبيوتر|شاشة\s+عريضة|horizontal|landscape|widescreen|banner|desktop|16:9|cinematic\s+wide/i.test(
      p,
    )
  ) {
    return { width: 1024, height: 768, aspect: 'horizontal' };
  }

  // Default square for social feeds and general showcase
  return { width: 1024, height: 1024, aspect: 'square' };
}

/**
 * Strips user command words like "ارسم لي صورة", "صمم بوستر لـ"
 */
export function extractCleanSubject(raw: string): string {
  let s = raw
    .replace(
      /^(?:ارسم(?:\s+لي)?|انشئ\s+صور[ةه]|أنشئ\s+صور[ةه]|انشاء\s+صور[ةه]|إنشاء\s+صور[ةه]|ولد\s+صور[ةه]|ولّد\s+صور[ةه]|صمم\s+صور[ةه]|صمم\s+بوستر|انشئ\s+بوستر|صمم\s+لي|ابغى\s+صور[ةه]|أريد\s+صور[ةه]|اريد\s+صور[ةه]|سوي(?:\s+لي)?\s+صور[ةه]|اصنع\s+صور[ةه]|اعمل\s+صور[ةه]|صور[ةه](?:\s+عن|\s+لـ|\s+حول)?|create an? image(?:\s+of)?|generate an? image(?:\s+of)?|draw(?:\s+an? image of)?)\s*/i,
      '',
    )
    .trim();

  // Remove markdown artifacts and bracketed text
  s = s.replace(/\[(?:Attached\s+file|attached)[^\]]*\]/gi, ' ');
  s = s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Builds the ultimate production-grade prompt recipe based on visual archetype.
 */
export function buildMasterVisualPrompt(
  cleanSubjectEnglish: string,
  archetype: VisualArchetype,
  aspect: 'vertical' | 'horizontal' | 'square',
): { prompt: string; negative: string } {
  const subject = cleanSubjectEnglish.trim();

  switch (archetype) {
    case 'graphic_poster': {
      const composition =
        aspect === 'vertical'
          ? 'vertical advertising poster layout, balanced negative space at top, striking central hero placement, clean geometric pedestal'
          : 'cinematic widescreen commercial banner composition, asymmetric visual balance, prominent hero product display';

      const prompt =
        `Masterpiece award-winning commercial graphic advertising poster. ` +
        `Subject: ${subject}. ` +
        `Composition: ${composition}. ` +
        `Typography & Graphic Design: sleek modern typography elements, crisp razor-sharp lettering, graphic vector accents, sophisticated visual hierarchy. ` +
        `Lighting: high-end commercial studio lighting, softbox key light, subtle specular rim highlights outlining the silhouette, elegant glossy ground reflections. ` +
        `Render Quality: Octane Render 3D meets flat graphic poster design, pristine textures, vibrant color contrast, 8k resolution, Behance trending, Dribbble featured design.`;

      const negative =
        'blurry, deformed, low quality, warped text, misspelled typography, artifacts, watermark, logo cutoff, messy composition, noisy, grain';

      return { prompt, negative };
    }

    case 'photorealistic_portrait': {
      const prompt =
        `Authentic award-winning editorial portrait photograph of ${subject}. ` +
        `Camera & Lens: Shot on Hasselblad H6D-100c medium format camera, 85mm f/1.4 lens, shallow depth of field. ` +
        `Texture & Realism: hyperrealistic natural skin texture with subtle visible pores, authentic subsurface skin scattering, individual hair strands, lifelike catchlight in the eyes. ` +
        `Lighting: soft cinematic volumetric window light, subtle warm rim lighting, natural atmospheric shadows. ` +
        `Aesthetic: raw uncompressed 8k photograph, National Geographic and Vogue editorial aesthetic, natural color grading.`;

      const negative =
        'plastic skin, CGI, 3D render, smooth airbrushed face, cartoon, doll face, fake eyes, extra fingers, deformed hands, oversaturated, blurry';

      return { prompt, negative };
    }

    case 'commercial_product': {
      const prompt =
        `Luxury commercial product photography and 3D studio render of ${subject}. ` +
        `Setting: minimalist high-end studio presentation, product showcased elegantly on a polished geometric pedestal with subtle grounded reflection. ` +
        `Lighting: professional dual softbox lighting, precision edge specular highlights, raytraced reflections, crisp ambient occlusion. ` +
        `Details: macro product textures, immaculate industrial design materials, Apple and Nike commercial campaign perfection, 8k ultra-sharp.`;

      const negative =
        'blurry background, cluttered, low resolution, cheap plastic look, washed out colors, noisy, bad lighting';

      return { prompt, negative };
    }

    case 'architectural_interior': {
      const prompt =
        `Architectural Digest editorial photograph of ${subject}. ` +
        `Composition: wide-angle architectural framing, balanced linear perspective, majestic volumetric space. ` +
        `Materials & Light: rich marble, polished warm wood, ambient golden hour sunlight streaming through floor-to-ceiling windows. ` +
        `Quality: ultra-detailed 8k interior design showcase, photorealistic textures, clean Scandinavian meets luxury Arabic aesthetic.`;

      const negative =
        'distorted perspective, fish-eye distortion, messy clutter, low quality render, cartoon, oversaturated';

      return { prompt, negative };
    }

    case 'cinematic_landscape': {
      const prompt =
        `Breathtaking cinematic landscape photograph of ${subject}. ` +
        `Atmosphere: epic dramatic vista, atmospheric haze, volumetric god rays, majestic scale. ` +
        `Camera: shot on Sony A7R V with wide dynamic range, deep depth of field, stunning natural geological textures. ` +
        `Color & Light: golden hour illumination, rich cinematic color grading, 8k wallpaper perfection.`;

      const negative =
        'oversaturated, artificial colors, blurry, noisy, painterly smear, low resolution';

      return { prompt, negative };
    }

    case 'creative_general':
    default: {
      const prompt =
        `Masterpiece high-fidelity visual artwork of ${subject}. ` +
        `Lighting & Detail: dramatic cinematic lighting, rich specular highlights, intricate textures, volumetric depth. ` +
        `Style: ultra-detailed 8k resolution, award-winning visual composition, trending on ArtStation and Behance.`;

      const negative =
        'blurry, noisy, low resolution, watermark, deformed, bad anatomy, artifacts';

      return { prompt, negative };
    }
  }
}
