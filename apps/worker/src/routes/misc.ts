import type {
  MemoryCreateRequest, MemoryResponse, ProviderId, SettingsResponse, SettingsUpdateRequest,
  TaskCreateRequest, TasksResponse, UploadResponse, UsageResponse,
} from '@nova/shared';
import { isBinaryPath, maskSecretSafe, newId, truncate } from '@nova/shared';
import type { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { badRequest, forbidden, notFound, tooLarge, unauthorized } from '../lib/errors.js';

const TEXTUAL_MIME = /^(text\/|application\/(json|javascript|typescript|xml|x-yaml|yaml)|.*\+(json|xml)$)/i;

export function registerMiscRoutes(app: Hono<AppEnv>) {
  /* ---------------------------------------------------------------- tasks */

  app.get('/api/tasks', async (c) => {
    const d = c.get('deps');
    const projectId = c.req.query('projectId');
    const runId = c.req.query('runId');
    const tasks = await d.store.listTasks({ projectId: projectId ?? undefined, runId: runId ?? undefined });
    const body: TasksResponse = { tasks };
    return c.json(body);
  });

  app.post('/api/tasks', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as TaskCreateRequest;
    if (!req.title?.trim()) throw badRequest('title is required', 'missing_title');
    const task = await d.store.createTask({
      projectId: req.projectId ?? null,
      runId: req.runId ?? null,
      title: truncate(req.title.trim(), 200),
      detail: req.detail ? truncate(req.detail, 2000) : '',
      status: req.status ?? 'pending',
    });
    return c.json({ task }, 201);
  });

  app.patch('/api/tasks/:id', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as Partial<TaskCreateRequest>;
    const task = await d.store.updateTask(c.req.param('id'), { title: req.title, detail: req.detail, status: req.status });
    if (!task) throw notFound('task not found');
    return c.json({ task });
  });

  app.delete('/api/tasks/:id', async (c) => {
    const d = c.get('deps');
    await d.store.deleteTask(c.req.param('id'));
    return c.json({ ok: true });
  });

  /* --------------------------------------------------------------- memory */

  app.get('/api/memory', async (c) => {
    const d = c.get('deps');
    const scope = (c.req.query('scope') ?? 'project') as 'project' | 'global';
    const scopeId = scope === 'project' ? c.req.query('scopeId') ?? null : null;
    const entries = await d.store.listMemory(scope, scopeId);
    const body: MemoryResponse = { entries };
    return c.json(body);
  });

  app.post('/api/memory', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as MemoryCreateRequest;
    if (!req.key?.trim()) throw badRequest('key is required', 'missing_key');
    if (req.scope === 'project' && !req.scopeId) throw badRequest('scopeId is required for project memory', 'missing_scope');
    const entry = await d.store.upsertMemory({
      scope: req.scope === 'global' ? 'global' : 'project',
      scopeId: req.scope === 'global' ? null : req.scopeId ?? null,
      key: truncate(req.key.trim(), 120),
      content: truncate(req.content ?? '', 4000),
    });
    return c.json({ entry }, 201);
  });

  app.delete('/api/memory/:id', async (c) => {
    const d = c.get('deps');
    await d.store.deleteMemory(c.req.param('id'));
    return c.json({ ok: true });
  });

  /* ----------------------------------------------------------- uploads/R2 */

  app.post('/api/uploads', async (c) => {
    const d = c.get('deps');
    const form = await c.req.formData().catch(() => null);
    const rawFile = form?.get('file') as unknown;
    if (!(rawFile instanceof File)) throw badRequest('multipart field "file" is required', 'missing_file');
    const file: File = rawFile;
    if (file.size > d.cfg.maxUploadBytes) {
      throw tooLarge(`file is ${file.size} bytes; the limit is ${d.cfg.maxUploadBytes} bytes`, 'file_too_large');
    }
    const conversationId = (form?.get('conversationId') as string) || null;
    const projectId = (form?.get('projectId') as string) || null;
    const id = newId('att');
    const key = `uploads/${id}/${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await d.blob.put(key, bytes, { contentType: file.type || 'application/octet-stream' });

    // Text extraction is what actually reaches the model — be explicit about limits.
    let excerpt: string | null = null;
    let warning: string | undefined;
    const looksTextual = TEXTUAL_MIME.test(file.type) || /\.(txt|md|json|csv|log|ya?ml|xml|ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|css|html|sh|sql|toml)$/i.test(file.name);
    if (looksTextual && !isBinaryPath(file.name)) {
      const text = new TextDecoder().decode(bytes);
      excerpt = truncate(text, 120_000);
      if (text.length > 120_000) warning = `Only the first 120,000 characters are sent to the model (file has ${text.length}).`;
    } else {
      warning = `Binary or unsupported type ("${file.type || 'unknown'}"): stored in R2 but not sent to the model as text. Vision-capable models would need an image pipeline, which is not implemented yet.`;
    }

    const attachment = await d.store.createAttachment({
      id,
      conversationId,
      projectId,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      blobKey: key,
      textExcerpt: excerpt,
    });
    const body: UploadResponse = {
      attachment: { id: attachment.id, name: attachment.name, mime: attachment.mime, size: attachment.size, url: attachment.url, text: attachment.text },
      extractedChars: excerpt?.length ?? 0,
      warning,
    };
    return c.json(body, 201);
  });

  app.get('/api/uploads/:id', async (c) => {
    const d = c.get('deps');
    const record = await d.store.getAttachment(c.req.param('id'));
    if (!record) throw notFound('attachment not found');
    const blob = await d.blob.get(record.blobKey);
    if (!blob) throw notFound('attachment bytes are missing from storage');
    return new Response(blob.data as unknown as BodyInit, {
      headers: {
        'content-type': blob.contentType ?? record.mime,
        'content-length': String(blob.size),
        'content-disposition': `inline; filename="${record.name.replace(/"/g, '')}"`,
      },
    });
  });

  /* ------------------------------------------------- usage/settings/admin */

  app.get('/api/usage', async (c) => {
    const d = c.get('deps');
    const summary = await d.store.usageSummary(Number(c.req.query('limit') ?? 100));
    const body: UsageResponse = summary;
    return c.json(body);
  });

  app.get('/api/settings', async (c) => {
    const d = c.get('deps');
    const s = await d.store.getSettings();
    const body: SettingsResponse = { locale: s.locale, dir: s.locale === 'ar' ? 'rtl' : 'ltr', defaults: s.defaults, agent: s.agent };
    return c.json(body);
  });

  app.put('/api/settings', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as SettingsUpdateRequest;
    if (req.locale && !['ar', 'en'].includes(req.locale)) throw badRequest('locale must be "ar" or "en"', 'bad_locale');
    const saved = await d.store.saveSettings({
      locale: req.locale,
      defaults: req.defaults,
      agent: req.agent ? { maxSteps: Math.min(Math.max(req.agent.maxSteps ?? 12, 1), 30), autoApply: Boolean(req.agent.autoApply), allowTerminal: Boolean(req.agent.allowTerminal) } : undefined,
    });
    const body: SettingsResponse = { locale: saved.locale, dir: saved.locale === 'ar' ? 'rtl' : 'ltr', defaults: saved.defaults, agent: saved.agent };
    return c.json(body);
  });

  /**
   * Optional runtime key injection.
   * Disabled unless NOVA_ALLOW_RUNTIME_KEYS=true and NOVA_ADMIN_TOKEN matches.
   * Keys are held in memory for the isolate lifetime only: never written to D1,
   * never written to R2, never echoed back (only a masked fingerprint is).
   */
  app.post('/api/admin/provider-keys', async (c) => {
    const d = c.get('deps');
    if (!d.cfg.allowRuntimeKeys) throw forbidden('Runtime key injection is disabled (NOVA_ALLOW_RUNTIME_KEYS=false). Put keys in .dev.vars instead.', 'runtime_keys_disabled');
    if (!d.cfg.adminToken) throw forbidden('NOVA_ADMIN_TOKEN is not set, so this endpoint refuses all requests.', 'admin_token_missing');
    const token = c.req.header('x-nova-admin') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (token !== d.cfg.adminToken) throw unauthorized('invalid admin token', 'bad_token');

    const req = (await c.req.json().catch(() => ({}))) as { provider?: ProviderId; apiKey?: string; baseUrl?: string; remove?: boolean };
    const provider = req.provider;
    if (!provider || !['openrouter', 'groq', 'custom', 'workers-ai'].includes(provider)) throw badRequest('provider must be openrouter, groq, custom or workers-ai', 'bad_provider');
    if (req.remove) {
      d.secrets.delete(provider);
      return c.json({ ok: true, provider, removed: true });
    }
    if (!req.apiKey || typeof req.apiKey !== 'string') throw badRequest('apiKey is required', 'missing_key');
    d.secrets.set(provider, req.apiKey, req.baseUrl);
    return c.json({ ok: true, provider, masked: maskSecretSafe(req.apiKey), stored: 'memory-only (lost on restart, never persisted)' });
  });

  app.get('/api/admin/provider-keys', async (c) => {
    const d = c.get('deps');
    if (!d.cfg.allowRuntimeKeys) throw forbidden('Runtime key injection is disabled.', 'runtime_keys_disabled');
    if (!d.cfg.adminToken) throw forbidden('NOVA_ADMIN_TOKEN is not set.', 'admin_token_missing');
    const token = c.req.header('x-nova-admin') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (token !== d.cfg.adminToken) throw unauthorized('invalid admin token', 'bad_token');
    return c.json({ keys: d.secrets.list() });
  });
}
