import type { ChatRequest, ServerEvent } from '@nova/shared';
import { newId, truncate } from '@nova/shared';
import type { Hono } from 'hono';
import type { ChatTurn } from '../ai/types.js';
import type { AppEnv } from '../context.js';
import { badRequest, describeError, HttpError } from '../lib/errors.js';
import { sseResponse } from '../lib/sse.js';
import { buildChatSystemPrompt } from '../agent/prompts.js';
import { runAgent } from '../agent/loop.js';
import { detectStudioIntent, generateCloudImage } from './studio.js';
import { performSafeGitHubSearch, performSafeJinaFetch, performSafeWebSearch } from '../agent/tools/web-search.js';
import { classifySkillIntent } from '../agent/skills/router.js';

/** Read-only tool set for project-aware chat (no mutations, ever). */
const CHAT_TOOLS = [
  'web_search',
  'web_fetch',
  'github_search',
  'list_files',
  'read_file',
  'search_project',
  'read_memory',
  'git_status',
  'git_log',
];

export function detectWebSearchIntent(message: string, forceWebSearch = false): { isSearch: boolean; isGitHub: boolean; query: string } {
  const m = message.trim();
  if (!m) return { isSearch: false, isGitHub: false, query: '' };

  if (forceWebSearch) {
    const cleaned = m
      .replace(/^(?:ابحث|دور|هات|طلع|search|find|google)(?:\s+(?:عن|في|حول|for|the))?\s*/i, '')
      .trim();
    return { isSearch: true, isGitHub: /github|مستودع|كود|repo/i.test(m), query: cleaned || m };
  }

  const ghMatch =
    m.match(/(?:شوف|ابحث|دور|هات|طلع)(?:\s+لي)?(?:\s+من)?\s+(?:جت\s*هاب|جيت\s*هاب|github)(?:\s+(?:عن|في|حول))?\s+(.+)/i) ||
    m.match(/(?:search|find)(?:\s+on)?\s+github(?:\s+for)?\s+(.+)/i) ||
    m.match(/github\.com\/([a-zA-Z0-9_\-\/]+)/i);
  if (ghMatch) {
    return { isSearch: true, isGitHub: true, query: ghMatch[1].trim() };
  }

  const webExplicitMatch =
    m.match(/(?:ابحث|دور|هات|طلع|شف)(?:\s+لي)?\s+(?:في\s+)?(?:النت|الانترنت|الإنترنت|الويب|قوقل|جوجل)(?:\s+(?:عن|في|حول))?\s+(.+)/i) ||
    m.match(/(?:search|find|google)(?:\s+the)?\s+(?:web|internet|google)(?:\s+for)?\s+(.+)/i);
  if (webExplicitMatch) {
    return { isSearch: true, isGitHub: false, query: webExplicitMatch[1].trim() };
  }

  // Conversational greetings with temporal words (e.g. "كيف حالك اليوم", "how are you today") are not search queries
  if (
    /^(?:مرحبا|أهلا|اهلا|السلام عليكم|صباح الخير|مساء الخير|كيف حالك|كيفك|شخبارك|hi|hello|hey|how are you|good morning|good evening)/i.test(m) &&
    m.length < 35
  ) {
    return { isSearch: false, isGitHub: false, query: '' };
  }

  // Auto-search router: detect real-time facts, current events, recent releases, prices, weather, scores, or post-cutoff queries
  const temporalRe =
    /(?:أخبار|اخر\s+اخبار|آخر\s+أخبار|أحدث|احدث|سعر|اسعار|أسعار|طقس|مباراة|نتائج|تاريخ\s+اليوم|من\s+فاز|متى\s+نزل|إصدار\s+جديد|تحديث\s+جديد|latest|current|today|yesterday|now|recent|price|weather|who\s+won|release\s+date|version|2024|2025|2026|2027)/i;

  if (temporalRe.test(m) && m.length > 5) {
    const cleanQ = m
      .replace(/^(?:ما\s+هو|ماذا\s+عن|علمني\s+عن|أخبرني\s+عن|هل\s+تعرف|tell\s+me\s+about|what\s+is|what\s+are)\s+/i, '')
      .trim();
    return { isSearch: true, isGitHub: false, query: cleanQ };
  }

  if (/(?:برزنتيشن|عرض\s+تقديمي|قالب\s+عرض|مستودع|مكتبة)\s+(?:عن|لـ|في)\s+(.+)/i.test(m)) {
    const q = m.match(/(?:برزنتيشن|عرض\s+تقديمي|قالب\s+عرض|مستودع|مكتبة)\s+(?:عن|لـ|في)\s+(.+)/i)?.[1]?.trim();
    if (q && q.length >= 3) {
      return { isSearch: true, isGitHub: false, query: q };
    }
  }

  return { isSearch: false, isGitHub: false, query: '' };
}

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
    const hasAttachments = Array.isArray(req.attachments) && req.attachments.length > 0;
    const effectiveMessage =
      typeof req.message === 'string' && req.message.trim()
        ? req.message
        : hasAttachments
          ? 'حلل واشرح الوسائط المرفقة بالتفصيل.'
          : '';
    if (!effectiveMessage) throw badRequest('message is required', 'bad_message');
    if (effectiveMessage.length > 200_000) throw badRequest('message is too long (max 200,000 characters)', 'too_long');

    const precomputedStudioIntent = !hasAttachments
      ? detectStudioIntent(effectiveMessage, req.studioMode)
      : req.studioMode === 'website'
        ? 'website'
        : null;

    // Enforce per-user daily quota (and 7-day lockout on exhaustion) before mutating DB or invoking AI.
    if (d.currentUser) {
      const quotaCost = precomputedStudioIntent === 'image' ? 2 : 1;
      await d.auth.consumeQuota(d.currentUser.id, quotaCost);
    }

    // Resolve (or create) the conversation before streaming starts.
    let conversation = req.conversationId ? await d.store.getConversation(req.conversationId) : null;
    if (req.conversationId && !conversation) throw badRequest(`conversation ${req.conversationId} not found`, 'not_found');
    if (!conversation) {
      conversation = await d.store.createConversation({
        projectId: req.projectId ?? null,
        modelId: req.modelId ?? null,
        modelClass: req.modelClass ?? 'chat',
        title: truncate(effectiveMessage.replace(/\s+/g, ' ').trim(), 60),
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
      content: effectiveMessage,
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
        const studioIntent = detectStudioIntent(effectiveMessage, req.studioMode);

        // Direct Cloud GPU Image Studio Generation ($0 free)
        if (studioIntent === 'image') {
          const studioModelId = 'nova-studio/cloud-image';
          emit({
            type: 'ready',
            requestId: c.get('requestId'),
            modelId: studioModelId,
            provider: 'workers-ai',
            warnings: [],
          });
          emit({ type: 'message.start', messageId: assistantMessageId, modelId: studioModelId, provider: 'workers-ai' });

          const generated = await generateCloudImage(d, { prompt: effectiveMessage, conversationId, projectId, signal });

          emit({ type: 'text.delta', messageId: assistantMessageId, text: generated.markdown });
          await d.store.appendMessage({
            id: assistantMessageId,
            conversationId,
            role: 'assistant',
            content: generated.markdown,
            status: 'complete',
            modelId: studioModelId,
            providerId: 'workers-ai',
          });
          emit({ type: 'message.done', messageId: assistantMessageId, tokensIn: 0, tokensOut: 0, finishReason: 'stop' });
          if (isNew) await maybeTitle(d, conversationId, effectiveMessage, emit);
          return;
        }

        const history = await d.store.listMessages(conversationId, 40);
        const [memory, project] = await Promise.all([
          projectId ? d.store.listMemory('project', projectId) : Promise.resolve([]),
          projectId ? d.store.getProject(projectId) : Promise.resolve(null),
        ]);
        const globalMemory = await d.store.listMemory('global', null);

        const searchIntent = detectWebSearchIntent(effectiveMessage, req.webSearch);
        let webSearchContext = '';
        if (searchIntent.isSearch && searchIntent.query) {
          try {
            const hits = searchIntent.isGitHub
              ? await performSafeGitHubSearch(searchIntent.query, 5)
              : await performSafeWebSearch(searchIntent.query, 5);
            if (hits.length > 0) {
              // Deep Grounding via Jina Reader on top 1-2 search results for rich markdown content
              const deepFetches = await Promise.allSettled(
                hits.slice(0, 2).map((h) => performSafeJinaFetch(h.url, 2500))
              );

              const formattedSources = hits.map((h, i) => {
                const deep = deepFetches[i]?.status === 'fulfilled' ? deepFetches[i].value : null;
                const bodyExcerpt = deep && deep.content.length > 100
                  ? `\nKey Content (via Jina Reader):\n${deep.content}`
                  : '';
                return `[Source ${i + 1}]: ${h.title}\nURL: ${h.url}\nSummary: ${h.snippet}${bodyExcerpt}`;
              }).join('\n\n---\n\n');

              webSearchContext = `\n\n[LIVE VERIFIED WEB GROUNDING RESULTS (Current Time: ${new Date().toUTCString()})]:
Query: "${searchIntent.query}"

${formattedSources}

[Instructions: Synthesize the above live verified information into your answer. Cite sources as clickable markdown links [Title](URL). Maintain factual precision and note that live grounding ran securely via cloud endpoints.]`;
            }
          } catch {
            /* graceful fallback */
          }
        }

        let customSkills: any[] = [];
        try {
          const stored = await d.store.getSettings();
          if (Array.isArray(stored.customSkills)) customSkills = stored.customSkills;
        } catch {
          /* ignore */
        }
        const skillRouting = classifySkillIntent(effectiveMessage, req.activeSkills, customSkills);

        const system = [
          buildChatSystemPrompt({ memory: [...memory, ...globalMemory], project, studioMode: studioIntent ?? req.studioMode ?? null }),
          req.systemPrompt?.trim() ? req.systemPrompt.trim() : '',
          ...skillRouting.systemPromptAdditions,
        ]
          .filter(Boolean)
          .join('\n\n');
        const messages: ChatTurn[] = [{ role: 'system', content: system }];
        for (const m of history) {
          if (m.id === userMessageId) continue; // appended below with attachments
          if (m.role === 'system') continue;
          if (m.status === 'error' && !m.content) continue;
          messages.push({ role: m.role, content: truncate(m.content, 12_000) });
        }
        const userTurn: ChatTurn = { role: 'user', content: withAttachments(effectiveMessage + webSearchContext, req.attachments ?? []) };
        messages.push(userTurn);

        const imageRefs = (req.attachments ?? []).filter((a) => /^image\/(png|jpe?g|webp|gif)$/i.test(a.mime));

        // Resolve the model first so the client knows what is answering
        // (and sees any fallback warnings) before a single token arrives.
        let resolution: Awaited<ReturnType<typeof d.router.resolve>>;
        if (imageRefs.length > 0 && !req.modelId) {
          try {
            resolution = await d.router.resolve({
              modelId: undefined,
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
            modelClass: studioIntent === 'website' ? 'coding' : (req.modelClass ?? conversation!.modelClass ?? 'chat'),
          });
        }

        if (imageRefs.length > 0 && resolution.model.supportsVision) {
          const images: { mime: string; dataUrl: string }[] = [];
          for (const ref of imageRefs.slice(0, 4)) {
            const rec = await d.store.getAttachment(ref.id);
            if (!rec) continue;
            const blob = await d.blob.get(rec.blobKey);
            if (!blob || blob.size > 10 * 1024 * 1024) continue;
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
            maxTokens: req.maxTokens ?? (studioIntent === 'website' ? 8192 : undefined),
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

        let finalContent = (result.text || text).trim();
        let finalModel = result.model;
        let finalProvider = result.provider;

        if (!finalContent) {
          d.log.warn('primary model returned empty output, attempting fallback completion');
          try {
            const fallbackResolution = await d.router.resolve({
              modelClass: studioIntent === 'website' ? 'coding' : (req.modelClass ?? conversation!.modelClass ?? 'chat'),
            });
            if (fallbackResolution.model.id !== resolution.model.id) {
              const fallbackResult = await d.router.complete(
                {
                  modelId: fallbackResolution.model.id,
                  messages,
                  stream: true,
                  temperature: req.temperature,
                  maxTokens: req.maxTokens ?? (studioIntent === 'website' ? 8192 : undefined),
                  signal,
                },
                {
                  onText: (chunk) => {
                    text += chunk;
                    emit({ type: 'text.delta', messageId: assistantMessageId, text: chunk });
                  },
                },
                'chat',
              );
              finalContent = (fallbackResult.text || text).trim();
              finalModel = fallbackResult.model;
              finalProvider = fallbackResult.provider;
            }
          } catch {
            /* ignore fallback error */
          }
        }

        if (!finalContent) {
          throw new HttpError(502, 'تعذّر إكمال الرد من النموذج (تم إرجاع رد فارغ). يرجى المحاولة وسيقوم النظام باختيار نموذج بديل تلقائياً.', 'empty_response');
        }

        await d.store.appendMessage({
          id: assistantMessageId,
          conversationId,
          role: 'assistant',
          content: finalContent,
          status: 'complete',
          modelId: finalModel.id,
          providerId: finalProvider,
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
  const videos = (attachments ?? []).filter((a) => /^video\//i.test(a.mime));
  const parts: string[] = [];
  for (const v of videos) {
    parts.push(`\n\n[Attached video file: "${v.name}" (${v.mime}, ${v.size} bytes) — extracted keyframes from this video are attached as visual images so you can inspect the scenes.]`);
  }
  for (const a of textual) {
    parts.push(`\n\n--- attached file: ${a.name} (${a.mime}, ${a.size} bytes) ---\n${truncate(a.text!, 40_000)}`);
  }
  return parts.length > 0 ? `${message}${parts.join('')}` : message;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
