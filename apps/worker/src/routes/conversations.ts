import type { ConversationCreateRequest, ConversationListResponse, ConversationPatchRequest, MessagesResponse, ModelClass } from '@nova/shared';
import { MODEL_CLASSES, truncate } from '@nova/shared';
import type { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { badRequest, notFound } from '../lib/errors.js';

export function registerConversationRoutes(app: Hono<AppEnv>) {
  app.get('/api/conversations', async (c) => {
    const d = c.get('deps');
    const projectId = c.req.query('projectId');
    const includeArchived = c.req.query('archived') === '1';
    const conversations = await d.store.listConversations({
      projectId: projectId === undefined ? undefined : projectId === 'none' ? null : projectId,
      limit: Number(c.req.query('limit') ?? 100),
      includeArchived,
    });
    const body: ConversationListResponse = { conversations };
    return c.json(body);
  });

  app.post('/api/conversations', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as ConversationCreateRequest;
    if (req.modelClass && !MODEL_CLASSES.includes(req.modelClass)) {
      throw badRequest(`modelClass must be one of ${MODEL_CLASSES.join(', ')}`, 'bad_model_class');
    }
    if (req.projectId) {
      const project = await d.store.getProject(req.projectId);
      if (!project) throw notFound(`project ${req.projectId} not found`);
    }
    const conversation = await d.store.createConversation({
      title: req.title ? truncate(req.title, 80) : undefined,
      projectId: req.projectId ?? null,
      modelId: req.modelId ?? null,
      modelClass: (req.modelClass ?? 'chat') as ModelClass,
      memoryEnabled: req.memoryEnabled ?? true,
    });
    return c.json({ conversation }, 201);
  });

  app.get('/api/conversations/:id', async (c) => {
    const d = c.get('deps');
    const conversation = await d.store.getConversation(c.req.param('id'));
    if (!conversation) throw notFound('conversation not found');
    const messages = await d.store.listMessages(conversation.id);
    return c.json({ conversation, messages } satisfies { conversation: typeof conversation } & MessagesResponse);
  });

  app.patch('/api/conversations/:id', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => ({}))) as ConversationPatchRequest;
    if (req.modelClass && !MODEL_CLASSES.includes(req.modelClass)) throw badRequest('invalid modelClass', 'bad_model_class');
    const updated = await d.store.updateConversation(c.req.param('id'), {
      title: req.title ? truncate(req.title, 80) : undefined,
      modelId: req.modelId,
      modelClass: req.modelClass,
      projectId: req.projectId,
      memoryEnabled: req.memoryEnabled,
      archived: req.archived,
    });
    if (!updated) throw notFound('conversation not found');
    return c.json({ conversation: updated });
  });

  app.delete('/api/conversations/:id', async (c) => {
    const d = c.get('deps');
    const existing = await d.store.getConversation(c.req.param('id'));
    if (!existing) throw notFound('conversation not found');
    await d.store.deleteConversation(existing.id);
    return c.json({ ok: true });
  });

  app.get('/api/conversations/:id/messages', async (c) => {
    const d = c.get('deps');
    const messages = await d.store.listMessages(c.req.param('id'), Number(c.req.query('limit') ?? 500));
    const body: MessagesResponse = { messages };
    return c.json(body);
  });
}
