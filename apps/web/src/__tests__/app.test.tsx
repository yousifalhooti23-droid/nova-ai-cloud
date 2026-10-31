/**
 * UI integration tests.
 *
 * They render the real <App/> against a mocked fetch layer that speaks the same
 * contract as the worker (shapes come from @nova/shared), including real SSE
 * streams for /api/chat and /api/agent/run. Nothing here simulates a model
 * answer: the streamed text is whatever the mocked transport delivers, exactly
 * like the diagnostic echo provider used by the backend smoke test.
 *
 * CodeMirror is replaced by a plain <textarea> in these tests (its own
 * integration is covered in editor.test.tsx) so failures point at app logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from '@nova/shared';

vi.mock('@/components/code/EditorPane', () => ({
  EditorPane: ({ value, path, onChange }: { value: string; path: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="editor" data-path={path} value={value} onChange={(e) => onChange?.(e.target.value)} readOnly={false} />
  ),
}));

import App from '@/App';
import { useAppStore } from '@/store/app';
import { emptyStreaming, useChatStore } from '@/store/chat';
import { initialAgent, useCodeStore } from '@/store/code';
import { frame, installApiMock, jsonResponse, sseResponse, type ApiMock, type Handler } from './mockApi';
import * as fx from './fixtures';

let api: ApiMock;
let persistedMessages: ChatMessage[];

function defaultRoutes(): Record<string, Handler> {
  return {
    'GET /api/health': () => fx.health(),
    'GET /api/models': () => fx.models,
    'GET /api/models/workers-ai-probe': () => ({ mode: 'local', detail: 'local dev cannot reach the AI binding' }),
    'GET /api/sandbox/status': () => fx.sandboxStatus,
    'GET /api/settings': () => fx.settings,
    'PUT /api/settings': ({ body }) => ({ ...fx.settings, ...(body as object) }),
    'GET /api/settings/provider-keys': () => ({
      writable: true,
      persisted: true,
      keys: [
        { provider: 'openrouter', configured: false },
        { provider: 'custom', configured: false },
        { provider: 'groq', configured: false },
      ],
    }),
    'POST /api/settings/provider-keys': ({ body }) => ({
      ok: true,
      provider: body.provider,
      masked: 'sk-o…1234',
      persisted: true,
    }),
    'GET /api/conversations': () => ({ conversations: [] }),
    'POST /api/conversations': () => ({ conversation: { ...fx.conversation, id: 'conv_new', messageCount: 0 } }),
    'GET /api/conversations/:id/messages': () => ({ messages: persistedMessages }),
    'GET /api/projects': () => ({ projects: [fx.project] }),
    'GET /api/projects/:id/files': () => fx.fileSummaries,
    'GET /api/projects/:id/file': ({ query }) => fx.fileContent(query.get('path') ?? 'src/app.ts'),
    'GET /api/projects/:id/changes': () => ({ changes: [fx.change] }),
    'POST /api/changes/:changeId': ({ body }) => ({
      change: { ...fx.change, status: body.action === 'apply' ? 'applied' : 'rejected' },
    }),
    'GET /api/projects/:id/git/status': () => fx.gitStatus,
    'GET /api/projects/:id/commits': () => fx.commits,
    'GET /api/tasks': () => fx.tasks,
    'POST /api/tasks': () => ({ task: fx.tasks.tasks[0] }),
    'PATCH /api/tasks/:id': ({ body }) => ({ task: { ...fx.tasks.tasks[0], ...(body as object) } }),
    'GET /api/memory': () => ({ entries: [] }),
    'POST /api/memory': () => ({ entry: { id: 'mem_1', scope: 'project', scopeId: 'prj_1', key: 'note', content: 'x', createdAt: '2026-10-30T09:00:00.000Z', updatedAt: '2026-10-30T09:00:00.000Z' } }),
    'GET /api/usage': () => ({ records: [], totals: { tokensIn: 0, tokensOut: 0, byProvider: {} } }),
    'POST /api/sandbox/exec': () => jsonResponse({ error: 'Sandbox is not configured — command execution is disabled.', code: 'sandbox_not_configured' }, 503),
  };
}

function resetStores() {
  localStorage.clear();
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
  persistedMessages = [];
  useAppStore.setState({
    ready: false, health: null, models: null, sandbox: null, settings: null, probe: null,
    toasts: [], settingsOpen: false, settingsTab: 'general', offline: false, lastError: null,
    locale: 'ar', view: 'chat', sidebarCollapsed: false, editorFontSize: 13, editorWrap: false, diffMode: 'unified',
  });
  useChatStore.setState({
    conversations: [], activeId: null, messages: {}, loadingList: false, loadingMessages: false,
    streaming: { ...emptyStreaming },
    composer: { modelId: null, modelClass: 'chat', studioMode: 'chat', temperature: 0.7, systemPrompt: '', attachments: [], uploading: false },
    lastError: null,
  });
  useCodeStore.setState({
    projects: [], activeProjectId: null, files: [], openFiles: {}, activePath: null,
    changes: [], tasks: [], commits: [], git: null, memory: [],
    search: { query: '', running: false, result: null }, terminal: [],
    agent: { ...initialAgent }, loading: false, lastError: null,
  });
}

beforeEach(() => {
  resetStores();
  api = installApiMock(defaultRoutes());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openCodingView() {
  await userEvent.click(screen.getByRole('button', { name: /البرمجة/ }));
  // The project name appears both in the sidebar and in the code page header.
  const sidebar = (await screen.findByRole('complementary').catch(() => null)) ?? document.querySelector('aside');
  const item = within(sidebar as HTMLElement).getByText('demo-app');
  await userEvent.click(item);
  await waitFor(() => expect(useCodeStore.getState().activeProjectId).toBe('prj_1'));
}

describe('NOVA web UI', () => {
  it('boots in Arabic RTL and renders the chat workspace', async () => {
    render(<App />);

    expect(await screen.findByText('كيف أستطيع مساعدتك اليوم؟')).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');

    // Primary navigation is present in Arabic.
    expect(screen.getByRole('button', { name: /المحادثة/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /البرمجة/ })).toBeTruthy();

    // Boot data reached the stores.
    await waitFor(() => expect(useAppStore.getState().health?.ok).toBe(true));
    expect(useAppStore.getState().models?.models.length).toBeGreaterThan(0);
    expect(api.callsTo('/api/health').length).toBeGreaterThan(0);
  });

  it('states plainly that nothing is callable instead of faking an answer', async () => {
    api = installApiMock({
      ...defaultRoutes(),
      'GET /api/health': () => fx.health({ providers: [{ ...fx.workersAiProvider }, { ...fx.openrouterProvider }] }),
    });

    render(<App />);
    expect(await screen.findByText(/لا يوجد مزوّد يمكن الوصول إليه/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /المزوّدون/ })).toBeTruthy();
  });

  it('switches to English LTR and persists the preference server-side', async () => {
    render(<App />);
    await screen.findByText('كيف أستطيع مساعدتك اليوم؟');

    await userEvent.click(screen.getByLabelText('اللغة'));

    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
    expect(await screen.findByText('How can I help you today?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chat/ })).toBeTruthy();

    await waitFor(() => {
      const call = api.callsTo('/api/settings').find((c) => c.method === 'PUT');
      expect(call?.body).toMatchObject({ locale: 'en' });
    });
  });

  it('streams an assistant answer into the transcript', async () => {
    api = installApiMock({
      ...defaultRoutes(),
      'POST /api/conversations': () => ({ conversation: { ...fx.conversation, id: 'conv_stream' } }),
      'POST /api/chat': () =>
        sseResponse([
          frame('ready', { requestId: 'req_1', modelId: 'diagnostic:echo', provider: 'diagnostic', warnings: [] }),
          frame('message.start', { messageId: 'msg_1', modelId: 'diagnostic:echo', provider: 'diagnostic' }),
          frame('text.delta', { messageId: 'msg_1', text: 'مرحبًا ' }),
          frame('text.delta', { messageId: 'msg_1', text: 'من NOVA' }),
          frame('message.done', { messageId: 'msg_1', tokensIn: 12, tokensOut: 5, finishReason: 'stop' }),
          frame('usage', { tokensIn: 12, tokensOut: 5, modelId: 'diagnostic:echo', provider: 'diagnostic' }),
        ]),
    });

    // After the stream the store re-reads the persisted transcript.
    persistedMessages = [
      { id: 'msg_0', conversationId: 'conv_stream', role: 'user', content: 'قل مرحبًا', status: 'complete', createdAt: '2026-10-30T09:00:00.000Z' },
      { id: 'msg_1', conversationId: 'conv_stream', role: 'assistant', content: 'مرحبًا من NOVA', status: 'complete', modelId: 'diagnostic:echo', providerId: 'diagnostic', tokensIn: 12, tokensOut: 5, createdAt: '2026-10-30T09:00:01.000Z' },
    ];

    render(<App />);
    const box = await screen.findByPlaceholderText('اسأل عن أي شيء…');
    await userEvent.type(box, 'قل مرحبًا');
    await userEvent.keyboard('{Enter}');

    // The streamed bubble and the reloaded persisted copy can overlap briefly.
    expect((await screen.findAllByText('مرحبًا من NOVA', { exact: false })).length).toBeGreaterThan(0);

    const call = api.callsTo('/api/chat')[0];
    expect(call.method).toBe('POST');
    expect(call.body).toMatchObject({ message: 'قل مرحبًا', conversationId: 'conv_stream' });
    await waitFor(() => expect(useChatStore.getState().streaming.active).toBe(false));
  });

  it('marks unreachable and gated models as unusable in the picker', async () => {
    render(<App />);
    await screen.findByText('كيف أستطيع مساعدتك اليوم؟');

    await userEvent.click(screen.getByTitle('النموذج'));

    // Ready provider → its model is selectable.
    const echo = await screen.findByText('Echo');
    expect(echo).toBeTruthy();

    // Workers AI is not reachable locally → its models are disabled.
    // (The id also appears in the collapsed trigger, hence getAllByText.)
    const qwen = screen.getAllByText(/qwen3\.8 27b/i).at(-1)!;
    const qwenButton = qwen.closest('button') as HTMLButtonElement;
    expect(qwenButton.disabled).toBe(true);

    // Gated models are labelled, never offered silently.
    const gated = screen.getByText(/مقيّد — لا يُستخدم/);
    expect(gated).toBeTruthy();

    // The needs-remote reason is surfaced, not hidden.
    expect(screen.getAllByText(/يتطلب تشغيلًا عن بُعد/).length).toBeGreaterThan(0);
  });

  it('lists project files and loads one into the editor', async () => {
    render(<App />);
    await screen.findByText('كيف أستطيع مساعدتك اليوم؟');
    await openCodingView();

    // The tree renders base names; the full path lives in the title attribute.
    expect(await screen.findByText('app.ts')).toBeTruthy();
    expect(screen.getByText('README.md')).toBeTruthy();

    await userEvent.click(screen.getByText('app.ts'));

    const editor = (await screen.findByTestId('editor')) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain('export const answer = 42;'));
    expect(editor.dataset.path).toBe('src/app.ts');
    expect(api.callsTo('/api/projects/prj_1/file').length).toBeGreaterThan(0);
  });

  it('shows the agent proposal with its diff and applies it on approval', async () => {
    render(<App />);
    await screen.findByText('كيف أستطيع مساعدتك اليوم؟');
    await openCodingView();

    // The Changes tab carries the pending count.
    const tab = await screen.findByRole('button', { name: /التغييرات/ });
    await userEvent.click(tab);

    expect(await screen.findAllByText(/src\/app\.ts/)).toBeTruthy();
    // The pending count is shown both in the project bar and in the panel header.
    expect(screen.getAllByText(/معلّق/).length).toBeGreaterThan(0);
    // The diff body renders both sides of the edit.
    expect(screen.getByText(/export const answer = 42;/)).toBeTruthy();
    expect(screen.getByText(/updated by agent/)).toBeTruthy();

    // "موافقة" (approve one) and "موافقة على الكل" (approve all) both match.
    const approve = screen
      .getAllByRole('button', { name: /موافقة/ })
      .find((b) => b.textContent?.trim() === 'موافقة')!;
    expect(approve).toBeTruthy();
    await userEvent.click(approve);

    await waitFor(() => {
      const call = api.callsTo('/api/changes/chg_1')[0];
      expect(call.method).toBe('POST');
      expect(call.body).toMatchObject({ action: 'apply' });
    });
  });

  it('refuses terminal use and explains why when no sandbox is configured', async () => {
    render(<App />);
    await screen.findByText('كيف أستطيع مساعدتك اليوم؟');
    await openCodingView();

    await userEvent.click(await screen.findByRole('button', { name: /الطرفية/ }));

    expect(await screen.findByText(/NOVA_SANDBOX=worker\|http/)).toBeTruthy();
    const input = screen.getByPlaceholderText('الطرفية معطّلة') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText(/Fail-closed|لا تُنفَّذ|NOVA_SANDBOX/)).toBeTruthy();

    // The run button is inert — no command is sent to the API.
    const runButton = screen.getByRole('button', { name: /تشغيل/ }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
    expect(api.callsTo('/api/sandbox/exec').length).toBe(0);
  });

  it('streams an agent run: tool calls, proposal and awaiting-approval status', async () => {
    api = installApiMock({
      ...defaultRoutes(),
      'POST /api/agent/run': () =>
        sseResponse([
          frame('agent.start', { runId: 'run_9', modelId: 'diagnostic:echo', provider: 'diagnostic', maxSteps: 4 }),
          frame('agent.status', { runId: 'run_9', status: 'running', step: 1 }),
          frame('agent.tool.start', { runId: 'run_9', callId: 'call_1', name: 'read_file', args: { path: 'src/app.ts' } }),
          frame('agent.tool.result', { runId: 'run_9', callId: 'call_1', name: 'read_file', ok: true, output: 'export const answer = 42;', truncated: false }),
          frame('agent.change.proposed', {
            runId: 'run_9',
            change: fx.change,
            diff: [],
            additions: 1,
            deletions: 1,
          }),
          frame('agent.await.approval', { runId: 'run_9', changeIds: ['chg_1'], reason: 'بانتظار الموافقة' }),
          frame('agent.done', {
            runId: 'run_9',
            run: { id: 'run_9', projectId: 'prj_1', conversationId: null, modelId: 'diagnostic:echo', status: 'awaiting_approval', steps: 2, startedAt: '2026-10-30T09:00:00.000Z', finishedAt: '2026-10-30T09:00:02.000Z', summary: 'اقترحت تعديلًا واحدًا' },
            summary: 'اقترحت تعديلًا واحدًا',
          }),
        ]),
    });

    render(<App />);
    await screen.findByText('كيف أستطيع مساعدتك اليوم؟');
    await openCodingView();

    const prompt = await screen.findByPlaceholderText(/صف التغيير المطلوب/);
    await userEvent.type(prompt, 'غيّر القيمة إلى 43');
    await userEvent.click(screen.getByRole('button', { name: /تشغيل الوكيل/ }));

    // Tool activity is visible as it happens.
    expect((await screen.findAllByText(/read_file/)).length).toBeGreaterThan(0);
    // Shown in the status strip and in the run summary line.
    expect((await screen.findAllByText(/بانتظار موافقتك/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/اقترحت تعديلًا واحدًا/)).toBeTruthy();

    await waitFor(() => expect(useCodeStore.getState().agent.running).toBe(false));
    expect(useCodeStore.getState().agent.status).toBe('awaiting_approval');
    expect(api.bodyOf('/api/agent/run')).toMatchObject({ projectId: 'prj_1', prompt: 'غيّر القيمة إلى 43', autoApply: false });
  });

  it('saves a free OpenRouter key directly from Settings → Providers without touching .env', async () => {
    api = installApiMock({
      ...defaultRoutes(),
      'GET /api/health': () => fx.health({ providers: [{ ...fx.workersAiProvider }, { ...fx.openrouterProvider }] }),
    });

    render(<App />);
    const bannerBtn = await screen.findByRole('button', { name: 'المزوّدون' });
    await userEvent.click(bannerBtn);

    expect(await screen.findByText(/وضع مجاني 100%/)).toBeTruthy();
    const inputs = await screen.findAllByPlaceholderText(/sk-or-v1/);
    await userEvent.type(inputs[0], 'sk-or-v1-freekey9999');

    const saveButtons = screen.getAllByRole('button', { name: /حفظ وتفعيل فوراً/ });
    await userEvent.click(saveButtons[0]);

    await waitFor(() => {
      const call = api.callsTo('/api/settings/provider-keys').find((c) => c.method === 'POST');
      expect(call?.body).toMatchObject({ provider: 'openrouter', apiKey: 'sk-or-v1-freekey9999' });
    });
  });

  it('renders an interactive Live Website Preview iframe when the assistant generates an HTML website', async () => {
    const siteHtml = '```html\n<!DOCTYPE html><html lang="ar" dir="rtl"><head><title>قهوة نوفا</title></head><body><h1>مرحباً بكم في قهوة نوفا</h1><p>أفضل قهوة مختصة</p></body></html>\n```';
    api = installApiMock({
      ...defaultRoutes(),
      'GET /api/conversations': () => ({ conversations: [fx.conversation] }),
      'GET /api/conversations/:id/messages': () => ({
        messages: [
          {
            id: 'msg_site_1',
            conversationId: fx.conversation.id,
            role: 'assistant',
            content: siteHtml,
            status: 'complete',
            modelId: 'nova-coder',
            createdAt: '2026-10-30T10:00:00.000Z',
          },
        ],
      }),
    });

    render(<App />);
    const convBtn = await screen.findByText(fx.conversation.title);
    await userEvent.click(convBtn);

    expect(await screen.findByText('معاينة حية للموقع')).toBeTruthy();
    const iframe = screen.getByTitle('NOVA Live Website Preview') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('srcdoc')).toContain('قهوة نوفا');
  });
});
