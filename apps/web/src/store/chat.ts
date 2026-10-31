import { create } from 'zustand';
import type { ChatMessage, Conversation, ModelClass, ProviderId, ServerEvent, StudioMode } from '@nova/shared';
import { newId } from '@nova/shared';
import { api, describeApiError, type UploadResult } from '@/lib/api';
import { extractVideoKeyframes, isVideoMime } from '@/lib/media';
import { streamRequest, type StreamHandle } from '@/lib/sse';

export interface StreamingState {
  active: boolean;
  conversationId: string | null;
  messageId: string | null;
  text: string;
  reasoning: string;
  modelId: string | null;
  provider: ProviderId | null;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  warnings: string[];
}

export interface ComposerState {
  /** null = let the Model Router decide (recommended default). */
  modelId: string | null;
  modelClass: ModelClass;
  studioMode: StudioMode;
  temperature: number;
  systemPrompt: string;
  attachments: UploadResult[];
  uploading: boolean;
}

export const emptyStreaming: StreamingState = {
  active: false,
  conversationId: null,
  messageId: null,
  text: '',
  reasoning: '',
  modelId: null,
  provider: null,
  tokensIn: 0,
  tokensOut: 0,
  error: null,
  warnings: [],
};

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  messages: Record<string, ChatMessage[]>;
  loadingList: boolean;
  loadingMessages: boolean;
  streaming: StreamingState;
  composer: ComposerState;
  lastError: { message: string; hint?: string } | null;

  loadConversations: (projectId?: string | null) => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  newConversation: (projectId?: string | null) => Promise<string>;
  renameConversation: (id: string, title: string) => Promise<void>;
  patchConversation: (id: string, patch: { projectId?: string | null; modelId?: string | null; modelClass?: ModelClass; memoryEnabled?: boolean }) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  reloadMessages: (id: string) => Promise<void>;
  setComposer: (patch: Partial<ComposerState>) => void;
  addAttachment: (file: File, projectId?: string | null) => Promise<void>;
  removeAttachment: (id: string) => void;
  send: (text: string, projectId?: string | null, studioModeOverride?: StudioMode) => Promise<void>;
  stop: () => void;
  regenerate: (projectId?: string | null) => Promise<void>;
  reset: () => void;
}

/** Kept outside the store: an AbortController must not trigger re-renders. */
let handle: StreamHandle | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: {},
  loadingList: false,
  loadingMessages: false,
  streaming: emptyStreaming,
  composer: { modelId: null, modelClass: 'chat', studioMode: 'chat', temperature: 0.7, systemPrompt: '', attachments: [], uploading: false },
  lastError: null,

  async loadConversations(projectId) {
    set({ loadingList: true });
    try {
      const { conversations } = await api.listConversations(projectId);
      set({ conversations, loadingList: false });
    } catch (err) {
      set({ loadingList: false, lastError: describeApiError(err) });
    }
  },

  async openConversation(id) {
    set({ activeId: id });
    if (!get().messages[id]) await get().reloadMessages(id);
  },

  async newConversation(projectId) {
    try {
      const { conversation } = await api.createConversation({
        projectId: projectId ?? null,
        modelId: get().composer.modelId,
        modelClass: get().composer.modelClass,
        memoryEnabled: Boolean(projectId),
      });
      set((s) => ({
        conversations: [conversation, ...s.conversations],
        activeId: conversation.id,
        messages: { ...s.messages, [conversation.id]: [] },
        lastError: null,
      }));
      return conversation.id;
    } catch (err) {
      set({ lastError: describeApiError(err) });
      // Still return a local placeholder id so the composer can send; the
      // server creates the conversation on first message.
      const local = newId('conv_local');
      set((s) => ({ activeId: local, messages: { ...s.messages, [local]: [] } }));
      return local;
    }
  },

  async renameConversation(id, title) {
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)) }));
    try {
      await api.patchConversation(id, { title });
    } catch {
      await get().loadConversations();
    }
  },

  async patchConversation(id, patch) {
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    try {
      await api.patchConversation(id, patch);
    } catch (err) {
      set({ lastError: describeApiError(err) });
    }
  },

  async deleteConversation(id) {
    try {
      await api.deleteConversation(id);
    } catch (err) {
      set({ lastError: describeApiError(err) });
      return;
    }
    set((s) => {
      const messages = { ...s.messages };
      delete messages[id];
      return {
        conversations: s.conversations.filter((c) => c.id !== id),
        messages,
        activeId: s.activeId === id ? (s.conversations.find((c) => c.id !== id)?.id ?? null) : s.activeId,
      };
    });
  },

  async reloadMessages(id) {
    set({ loadingMessages: true });
    try {
      const { messages } = await api.messages(id);
      set((s) => ({ messages: { ...s.messages, [id]: messages }, loadingMessages: false }));
    } catch (err) {
      set({ loadingMessages: false, lastError: describeApiError(err) });
    }
  },

  setComposer(patch) {
    set((s) => ({ composer: { ...s.composer, ...patch } }));
  },

  async addAttachment(file, projectId) {
    set((s) => ({ composer: { ...s.composer, uploading: true } }));
    try {
      const uploaded: UploadResult[] = [];
      const main = await api.upload(file, projectId);
      uploaded.push(main);
      if (isVideoMime(file.type, file.name)) {
        const frames = await extractVideoKeyframes(file, 3);
        for (const frame of frames) {
          try {
            uploaded.push(await api.upload(frame, projectId));
          } catch {
            /* frame extraction/upload is best-effort */
          }
        }
      }
      set((s) => ({
        composer: { ...s.composer, uploading: false, attachments: [...s.composer.attachments, ...uploaded] },
      }));
    } catch (err) {
      set((s) => ({ composer: { ...s.composer, uploading: false }, lastError: describeApiError(err) }));
    }
  },

  removeAttachment(id) {
    set((s) => ({
      composer: { ...s.composer, attachments: s.composer.attachments.filter((a) => a.id !== id) },
    }));
  },

  async send(text, projectId, studioModeOverride) {
    const composer = get().composer;
    const trimmed = text.trim();
    if ((!trimmed && composer.attachments.length === 0) || get().streaming.active) return;
    const finalMessage = trimmed || 'حلل واشرح الوسائط المرفقة بالتفصيل.';
    const activeStudioMode = studioModeOverride ?? composer.studioMode;

    let conversationId = get().activeId;
    const isLocalPlaceholder = !conversationId || conversationId.startsWith('conv_local');
    if (isLocalPlaceholder) {
      try {
        const { conversation } = await api.createConversation({
          projectId: projectId ?? null,
          modelId: composer.modelId,
          modelClass: composer.modelClass,
          memoryEnabled: Boolean(projectId),
        });
        conversationId = conversation.id;
        set((s) => ({
          conversations: [conversation, ...s.conversations],
          activeId: conversation.id,
          messages: { ...s.messages, [conversation.id]: [] },
        }));
      } catch (err) {
        set({ lastError: describeApiError(err) });
        return;
      }
    }

    const targetId = conversationId!;
    const optimistic: ChatMessage = {
      id: newId('msg_local'),
      conversationId: targetId,
      role: 'user',
      content: finalMessage,
      attachments: composer.attachments.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, url: a.url })),
      status: 'complete',
      createdAt: new Date().toISOString(),
    };
    set((s) => ({
      messages: { ...s.messages, [targetId]: [...(s.messages[targetId] ?? []), optimistic] },
      streaming: { ...emptyStreaming, active: true, conversationId: targetId },
      lastError: null,
    }));

    const { url, init } = api.chatBody({
      conversationId: targetId,
      projectId: projectId ?? null,
      message: finalMessage,
      modelId: composer.modelId,
      modelClass: composer.modelClass,
      studioMode: activeStudioMode !== 'chat' ? activeStudioMode : undefined,
      temperature: composer.temperature,
      systemPrompt: composer.systemPrompt || undefined,
      attachments: composer.attachments.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, url: a.url })),
    });

    handle = streamRequest(url, init, (evt: ServerEvent) => applyChatEvent(set, get, evt, targetId));
    const result = await handle.done;
    handle = null;
    set((s) => ({ streaming: { ...s.streaming, active: false } }));
    if (!result.ok && result.error && result.error !== 'aborted') {
      set((s) => ({ streaming: { ...s.streaming, error: result.error ?? 'stream_failed' } }));
    }
    // Server is the source of truth for persisted messages.
    await get().reloadMessages(targetId);
    void get().loadConversations(projectId);
    set((s) => ({ composer: { ...s.composer, attachments: [], studioMode: 'chat' } }));
  },

  stop() {
    handle?.abort();
    handle = null;
    set((s) => ({ streaming: { ...s.streaming, active: false } }));
  },

  async regenerate(projectId) {
    const id = get().activeId;
    if (!id) return;
    const msgs = get().messages[id] ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    // Drop the trailing assistant answer locally; the server keeps history and
    // the reload after streaming restores the canonical list.
    set((s) => ({
      messages: {
        ...s.messages,
        [id]: (s.messages[id] ?? []).filter((m) => m.id !== lastUser.id || m.role !== 'assistant'),
      },
    }));
    await get().send(lastUser.content, projectId);
  },

  reset() {
    set({ activeId: null, messages: {}, streaming: emptyStreaming, lastError: null });
  },
}));

/** Fold one SSE event into the streaming slice. */
function applyChatEvent(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  _get: () => ChatState,
  evt: ServerEvent,
  conversationId: string,
) {
  switch (evt.type) {
    case 'ready':
      set((s) => ({
        streaming: { ...s.streaming, modelId: evt.modelId, provider: evt.provider, warnings: evt.warnings },
      }));
      break;
    case 'message.start':
      set((s) => ({
        streaming: {
          ...s.streaming,
          conversationId,
          messageId: evt.messageId,
          modelId: evt.modelId,
          provider: evt.provider,
          text: '',
          reasoning: '',
        },
      }));
      break;
    case 'text.delta':
      set((s) => ({ streaming: { ...s.streaming, text: s.streaming.text + evt.text } }));
      break;
    case 'reasoning.delta':
      set((s) => ({ streaming: { ...s.streaming, reasoning: s.streaming.reasoning + evt.text } }));
      break;
    case 'message.done':
      set((s) => ({
        streaming: {
          ...s.streaming,
          tokensIn: evt.tokensIn,
          tokensOut: evt.tokensOut,
          active: false,
        },
      }));
      break;
    case 'title.generated':
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === evt.conversationId ? { ...c, title: evt.title } : c)),
      }));
      break;
    case 'usage':
      set((s) => ({
        streaming: { ...s.streaming, tokensIn: evt.tokensIn, tokensOut: evt.tokensOut, modelId: evt.modelId, provider: evt.provider },
      }));
      break;
    case 'error':
      set((s) => ({ streaming: { ...s.streaming, error: evt.message, active: false } }));
      break;
    default:
      break;
  }
}
