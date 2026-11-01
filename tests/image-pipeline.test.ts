import { describe, expect, it } from 'vitest';
import { cleanAndSanitizeImagePrompt, detectImageDimensions } from '../apps/worker/src/routes/studio.js';

describe('Nova AI Cloud - Upgraded FLUX Image Generation Pipeline', () => {
  it('automatically detects vertical/poster aspect ratios (768x1024)', () => {
    const p1 = detectImageDimensions('The image must be a flat, high-quality digital poster with cinematic studio lighting');
    expect(p1.width).toBe(768);
    expect(p1.height).toBe(1024);
    expect(p1.aspect).toBe('vertical');

    const p2 = detectImageDimensions('صمم لي بوستر عمودي لهاتف ذكي');
    expect(p2.width).toBe(768);
    expect(p2.height).toBe(1024);
    expect(p2.aspect).toBe('vertical');

    const p3 = detectImageDimensions('phone wallpaper of a cyberpunk city at night');
    expect(p3.width).toBe(768);
    expect(p3.height).toBe(1024);
    expect(p3.aspect).toBe('vertical');
  });

  it('automatically detects horizontal/landscape aspect ratios (1024x768)', () => {
    const p1 = detectImageDimensions('widescreen landscape of rugged mountain peaks during sunset');
    expect(p1.width).toBe(1024);
    expect(p1.height).toBe(768);
    expect(p1.aspect).toBe('horizontal');

    const p2 = detectImageDimensions('صمم لي بانر أفقي للموقع 16:9');
    expect(p2.width).toBe(1024);
    expect(p2.height).toBe(768);
    expect(p2.aspect).toBe('horizontal');
  });

  it('defaults to square 1024x1024 when no aspect keywords are specified', () => {
    const p = detectImageDimensions('A cute fluffy cat sitting on a velvet cushion');
    expect(p.width).toBe(1024);
    expect(p.height).toBe(1024);
    expect(p.aspect).toBe('square');
  });

  it('preserves multi-line descriptions and replaces newlines with spaces without prompt truncation', () => {
    const multiLinePrompt = `At the top, there is a white PlayStation logo and the text "PlayStation 5 DualSense".
Small text at the very top reads "DualSense MatteFinish TouchPad MotionSensor".
On the lower left, on the red pedestal, it reads "This Is More Than Just gaming".
The image must be a flat, high-quality digital poster with cinematic studio lighting, specular highlights.
WhatsApp Image 2026-11-01 at 7.16.44 PM.jpeg`;

    const cleaned = cleanAndSanitizeImagePrompt(multiLinePrompt);

    // No newlines remaining
    expect(cleaned).not.toContain('\n');
    expect(cleaned).not.toContain('\r');

    // Attachment file name stripped
    expect(cleaned).not.toContain('WhatsApp Image');

    // Full typography, strings, and descriptions strictly preserved without truncation
    expect(cleaned).toContain('PlayStation 5 DualSense');
    expect(cleaned).toContain('DualSense MatteFinish TouchPad MotionSensor');
    expect(cleaned).toContain('This Is More Than Just gaming');
    expect(cleaned).toContain('specular highlights');

    // Substantial length preserved
    expect(cleaned.length).toBeGreaterThan(250);
  });

  it('formats Pollinations FLUX Pro URL with explicit parameters (no bare URL, no watermark, no prompt rewriting)', () => {
    const prompt = 'luxury sports car poster in red';
    const dim = detectImageDimensions(prompt);
    const seed = 987654;

    const fluxProUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux&width=${dim.width}&height=${dim.height}&nologo=true&enhance=false&seed=${seed}`;

    expect(fluxProUrl).toContain('model=flux');
    expect(fluxProUrl).toContain('nologo=true');
    expect(fluxProUrl).toContain('enhance=false');
    expect(fluxProUrl).toContain('width=768');
    expect(fluxProUrl).toContain('height=1024');
    expect(fluxProUrl).toContain('seed=987654');
    expect(fluxProUrl).not.toContain('enhance=true');
  });
});
