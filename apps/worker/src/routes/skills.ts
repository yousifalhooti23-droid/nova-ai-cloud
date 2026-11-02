import { BUILTIN_SKILLS, type NovaSkill, newId, truncate } from '@nova/shared';
import type { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { isSafeExternalUrl, performSafeJinaFetch } from '../agent/tools/web-search.js';

export function registerSkillsRoutes(app: Hono<AppEnv>) {
  // GET /api/skills -> List all skills (built-in + custom)
  app.get('/api/skills', async (c) => {
    const d = c.get('deps');
    let customSkills: NovaSkill[] = [];
    try {
      const stored = await d.store.getSettings();
      if (Array.isArray(stored.customSkills)) customSkills = stored.customSkills;
    } catch {
      /* ignore */
    }

    return c.json({
      skills: [...BUILTIN_SKILLS, ...customSkills],
    });
  });

  // POST /api/skills/import-github -> Import any skill/prompt from GitHub URL ($0 zero-cost)
  app.post('/api/skills/import-github', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as { url?: string };
    const rawUrl = typeof req.url === 'string' ? req.url.trim() : '';

    if (!rawUrl || !rawUrl.toLowerCase().includes('github')) {
      throw badRequest('الرجاء إدخال رابط صالح من GitHub (مستودع أو ملف SKILL.md أو ملف خام)', 'invalid_url');
    }

    if (!isSafeExternalUrl(rawUrl)) {
      throw forbidden('الرابط المدخل غير مسموح به أو يشير إلى شبكة داخلية محظورة.', 'ssrf_blocked');
    }

    d.log.info('importing skill from github', { url: rawUrl });

    // Format raw URL if pointing to a standard github blob file
    let fetchUrl = rawUrl;
    if (rawUrl.includes('github.com') && rawUrl.includes('/blob/')) {
      fetchUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    }

    let fetchedContent = '';
    let fetchedTitle = '';
    try {
      const jina = await performSafeJinaFetch(fetchUrl, 10000);
      fetchedContent = jina.content;
      fetchedTitle = jina.title;
    } catch (err) {
      throw badRequest(`تعذر جلب محتوى المهارة من GitHub: ${err instanceof Error ? err.message : String(err)}`, 'fetch_failed');
    }

    if (!fetchedContent || fetchedContent.length < 30) {
      throw badRequest('الملف المستورد فارغ أو لا يحتوي على تعليمات كافية لمهارة ذكاء اصطناعي.', 'empty_content');
    }

    // Parse frontmatter if present (name, description, etc.)
    let name = fetchedTitle.replace(/^Title:\s*/i, '').trim().slice(0, 50) || 'Custom Imported Skill';
    let description = 'مهارة مخصصة تم استيرادها مباشرة من مستودع GitHub.';
    let systemPrompt = fetchedContent;

    const nameMatch = fetchedContent.match(/(?:name|title|skill_name):\s*["']?([^"'\n\r]+)["']?/i);
    if (nameMatch && nameMatch[1]) name = nameMatch[1].trim();

    const descMatch = fetchedContent.match(/(?:description|summary):\s*["']?([^"'\n\r]+)["']?/i);
    if (descMatch && descMatch[1]) description = descMatch[1].trim();

    const skillId = `custom-skill-${newId('sk').slice(-6)}`;
    const newSkill: NovaSkill = {
      id: skillId,
      name,
      nameAr: name,
      description: truncate(description, 160),
      descriptionAr: truncate(description, 160),
      icon: 'Puzzle',
      category: 'specialized',
      systemPrompt: truncate(systemPrompt, 6000),
      isCustom: true,
      githubUrl: rawUrl,
      enabled: true,
      author: 'GitHub Community',
      version: '1.0.0',
    };

    let existingCustom: NovaSkill[] = [];
    try {
      const stored = await d.store.getSettings();
      if (Array.isArray(stored.customSkills)) existingCustom = stored.customSkills;
    } catch {
      /* ignore */
    }

    existingCustom = [newSkill, ...existingCustom.filter((s) => s.id !== skillId)];
    await d.store.saveSettings({ customSkills: existingCustom });

    return c.json({
      ok: true,
      skill: newSkill,
      message: `تم تثبيت مهارة "${name}" بنجاح وتفعيلها في Nova AI Cloud.`,
    });
  });

  // POST /api/skills/toggle -> Toggle a skill enabled/disabled
  app.post('/api/skills/toggle', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as { skillId?: string; enabled?: boolean };
    const { skillId, enabled } = req;
    if (!skillId) throw badRequest('skillId is required', 'missing_id');

    let customSkills: NovaSkill[] = [];
    try {
      const stored = await d.store.getSettings();
      if (Array.isArray(stored.customSkills)) customSkills = stored.customSkills;
    } catch {
      /* ignore */
    }

    const updated = customSkills.map((s) => (s.id === skillId ? { ...s, enabled: Boolean(enabled) } : s));
    await d.store.saveSettings({ customSkills: updated });

    return c.json({ ok: true, skillId, enabled: Boolean(enabled) });
  });
}
