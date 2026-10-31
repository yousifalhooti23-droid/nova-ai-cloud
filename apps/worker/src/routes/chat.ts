import type { ChatRequest, ServerEvent } from '@nova/shared';
import { newId, truncate } from '@nova/shared';
import type { Hono } from 'hono';
import type { ChatTurn } from '../ai/types.js';
import type { AppEnv } from '../context.js';
import { badRequest, describeError, HttpError } from '../lib/errors.js';
import { sseResponse } from '../lib/sse.js';
import { buildChatSystemPrompt } from '../agent/prompts.js';
import { runAgent } from '../agent/loop.js';

/** Read-only tool set for project-aware chat (no mutations, ever). */
const CHAT_TOOLS = ['list_files', 'read_file', 'search_project', 'read_memory', 'git_status', 'git_log'];

export function registerChatRoutes(app: Hono<AppEnv>) {
  /**
   * POST /api/chat — streaming chat completion.
   * Response is SSE (see packages/shared/src/sse.ts for the event contract).
   * Nothing is ever faked: if no provider is configured the stream carries an
   * explicit `error` event with the exact reason.
   */
  app.post('/api/chat', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => null)) as ChatRequest | null;
    if (!req) throw badRequest('JSON body is required', 'bad_body');
    if (typeof req.message !== 'string' || !req.message.trim()) throw badRequest('message is required', 'bad_message');
    if (req.message.length > 200_000) throw badRequest('message is too long (max 200,000 characters)', 'too_long');

    // Resolve (or create) the conversation before streaming starts.
    let conversation = req.conversationId ? await d.store.getConversation(req.conversationId) : null;
    if (req.conversationId && !conversation) throw badRequest(`conversation ${req.conversationId} not found`, 'not_found');
    if (!conversation) {
      conversation = await d.store.createConversation({
        projectId: req.projectId ?? null,
        modelId: req.modelId ?? null,
        modelClass: req.modelClass ?? 'chat',
        title: truncate(req.message.replace(/\s+/g, ' ').trim(), 60),
      });
    }
    const conversationId = conversation.id;
    const isNew = (await d.store.countMessages(conversationId)) === 0;
    const projectId = req.projectId ?? conversation.projectId ?? null;

    const userMessageId = newId('msg');
    await d.store.appendMessage({
      id: userMessageId,
      conversationId,
      role: 'user',
      content: req.message,
      attachments: req.attachments ?? [],
      status: 'complete',
      modelId: req.modelId ?? conversation.modelId ?? undefined,
    });

    // Project-aware chat with read-only tools delegates to the agent loop.
    if (req.enableTools && projectId) {
      const project = await d.store.getProject(projectId);
      if (!project) throw badRequest(`project ${projectId} not found`, 'not_found');
      return sseResponse(async (emit, signal) => {
        try {
          const outcome = await runAgent(
            { store: d.store, router: d.router, sandbox: d.sandbox, cfg: d.cfg, log: d.log },
            {
              projectId,
              conversationId: null, // messages were already persisted above
              prompt: req.message,
              modelId: req.modelId ?? conversation!.modelId,
              modelClass: req.modelClass ?? 'chat',
              maxSteps: 5,
              autoApply: false,
              allowTerminal: false,
              toolNames: CHAT_TOOLS,
            },
            emit,
            signal,
          );
          await d.store.appendMessage({
            id: newId('msg'),
            conversationId,
            role: 'assistant',
            content: outcome.summary,
            status: outcome.status === 'failed' ? 'error' : 'complete',
            modelId: outcome.modelId,
          });
          if (isNew) await maybeTitle(d, conversationId, req.message, emit);
        } catch (err) {
          const { message, code } = describeError(err);
          emit({ type: 'error', message, code });
          await d.store.appendMessage({ id: newId('msg'), conversationId, role: 'assistant', content: '', status: 'error', error: message });
        }
      });
    }

    return sseResponse(async (emit, signal) => {
      const assistantMessageId = newId('msg');
      try {
        const history = await d.store.listMessages(conversationId, 40);
        const [memory, project] = await Promise.all([
          projectId ? d.store.listMemory('project', projectId) : Promise.resolve([]),
          projectId ? d.store.getProject(projectId) : Promise.resolve(null),
        ]);
        const globalMemory = await d.store.listMemory('global', null);

        const system = buildChatSystemPrompt({ memory: [...memory, ...globalMemory], project });
        const messages: ChatTurn[] = [{ role: 'system', content: system }];
        for (const m of history) {
          if (m.id === userMessageId) continue; // appended below with attachments
          if (m.role === 'system') continue;
          if (m.status === 'error' && !m.content) continue;
          messages.push({ role: m.role, content: truncate(m.content, 12_000) });
        }
        const userTurn: ChatTurn = { role: 'user', content: withAttachments(req.message, req.attachments ?? []) };
        messages.push(userTurn);

        const imageRefs = (req.attachments ?? []).filter((a) => /^image\/(png|jpe?g|webp|gif)$/i.test(a.mime));

        // Resolve the model first so the client knows what is answering
        // (and sees any fallback warnings) before a single token arrives.
        let resolution: Awaited<ReturnType<typeof d.router.resolve>>;
        if (imageRefs.length > 0 && !req.modelId) {
          try {
            resolution = await d.router.resolve({
              modelId: conversation!.modelId,
              modelClass: req.modelClass ?? conversation!.modelClass ?? 'chat',
              requireVision: true,
            });
          } catch {
            resolution = await d.router.resolve({
              modelId: conversation!.modelId,
              modelClass: req.modelClass ?? conversation!.modelClass ?? 'chat',
            });
          }
        } else {
          resolution = await d.router.resolve({
            modelId: req.modelId ?? conversation!.modelId,
            modelClass: req.modelClass ?? conversation!.modelClass ?? 'chat',
          });
        }

        if (imageRefs.length > 0 && resolution.model.supportsVision) {
          const images: { mime: string; dataUrl: string }[] = [];
          for (const ref of imageRefs.slice(0, 4)) {
            const rec = await d.store.getAttachment(ref.id);
            if (!rec) continue;
            const blob = await d.blob.get(rec.blobKey);
            if (!blob || blob.size > 6 * 1024 * 1024) continue;
            const b64 = bytesToBase64(blob.data);
            images.push({ mime: rec.mime, dataUrl: `data:${rec.mime};base64,${b64}` });
          }
          if (images.length > 0) userTurn.images = images;
        } else if (imageRefs.length > 0) {
          resolution.warnings.push('Selected model does not support image input; attached images were not sent as pixels.');
        }
        emit({
          type: 'ready',
          requestId: c.get('requestId'),
          modelId: resolution.model.id,
          provider: resolution.model.provider,
          warnings: resolution.warnings,
        });
        emit({ type: 'message.start', messageId: assistantMessageId, modelId: resolution.model.id, provider: resolution.model.provider });

        let text = '';
        const result = await d.router.complete(
          {
            modelId: resolution.model.id,
            messages,
            stream: true,
            temperature: req.temperature,
            maxTokens: req.maxTokens,
            signal,
          },
          {
            onText: (chunk) => {
              text += chunk;
              emit({ type: 'text.delta', messageId: assistantMessageId, text: chunk });
            },
            onReasoning: (chunk) => emit({ type: 'reasoning.delta', messageId: assistantMessageId, text: chunk }),
          },
          'chat',
        );

        await d.store.appendMessage({
          id: assistantMessageId,
          conversationId,
          role: 'assistant',
          content: result.text || text,
          status: 'complete',
          modelId: result.model.id,
          providerId: result.provider,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        });
        emit({
          type: 'message.done',
          messageId: assistantMessageId,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          finishReason: result.finishReason,
        });
        emit({ type: 'usage', tokensIn: result.tokensIn, tokensOut: result.tokensOut, modelId: result.model.id, provider: result.provider });

        if (isNew) await maybeTitle(d, conversationId, req.message, emit);
      } catch (err) {
        const { message, code } = describeError(err);
        const notConfigured = err instanceof HttpError && err.code === 'provider_not_configured';
        emit({ type: 'error', message, code, retryable: code === 'rate_limited' });
        await d.store
          .appendMessage({
            id: assistantMessageId,
            conversationId,
            role: 'assistant',
            content: '',
            status: 'error',
            error: notConfigured ? `${message}\n\n${(err as HttpError).hint ?? ''}` : message,
          })
          .catch(() => undefined);
      }
    });
  });
}

async function maybeTitle(
  d: { router: { generateTitle(prompt: string): Promise<{ title: string; modelId: string } | null> }; store: { updateConversation(id: string, patch: { title?: string }): Promise<unknown> } },
  conversationId: string,
  prompt: string,
  emit: (evt: ServerEvent) => void,
) {
  const generated = await d.router.generateTitle(prompt);
  if (!generated) return;
  await d.store.updateConversation(conversationId, { title: truncate(generated.title, 70) });
  emit({ type: 'title.generated', conversationId, title: generated.title });
}

/** Attachments are inlined as text (that is what actually reaches the model). */
function withAttachments(message: string, attachments: ChatRequest['attachments']): string {
  const textual = (attachments ?? []).filter((a) => a.text && a.text.trim().length > 0);
  if (textual.length === 0) return message;
  const parts = textual.map((a) => `\n\n--- attached file: ${a.name} (${a.mime}, ${a.size} bytes) ---\n${truncate(a.text!, 40_000)}`);
  return `${message}${parts.join('')}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
