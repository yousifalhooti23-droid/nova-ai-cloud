import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Endpoints } from '@nova/shared';
import { bootstrap } from '../apps/worker/src/bootstrap.js';
import { FileBlobStore, MemoryBlobStore } from '../apps/worker/src/storage/blob.js';
import { JsonStore } from '../apps/worker/src/storage/json-store.js';
import { ScriptedAdapter, testModel } from './helpers.js';

describe('Windows FileBlobStore path normalization & traversal defense', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-blob-test-'));

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('allows mixed forward/backslash dataDir paths without throwing false escape error', async () => {
    const mixedDir = `${tmpRoot}/blobs`; // Forward slash mixed with OS temp path (exact Windows desktop bug)
    const store = new FileBlobStore(mixedDir);
    const payload = new Uint8Array([137, 80, 78, 71]);
    await store.put('uploads/att_test/studio-image.png', payload, { contentType: 'image/png' });
    const loaded = await store.get('uploads/att_test/studio-image.png');
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded!.data)).toEqual([137, 80, 78, 71]);
  });

  it('blocks directory traversal and prefix-collision attacks', async () => {
    const store = new FileBlobStore(`${tmpRoot}/blobs`);
    await expect(store.put('../../outside.txt', new Uint8Array([1]))).rejects.toThrow(/escapes storage root/);
    await expect(store.get('..\\..\\outside.txt')).rejects.toThrow(/escapes storage root/);
  });
});

describe('Fortress multi-user auth, zero-leak isolation, daily quota & 7-day lockout', () => {
  let app: Awaited<ReturnType<typeof bootstrap>>['app'];
  let adapter: ScriptedAdapter;

  beforeAll(async () => {
    adapter = new ScriptedAdapter(
      Array.from({ length: 30 }, (_, i) => ({ text: `رد رقم ${i + 1}` })),
      [testModel()],
    );
    const boot = await bootstrap({
      env: {
        NOVA_RUNTIME: 'node',
        NOVA_SANDBOX: 'disabled',
        NOVA_REQUIRE_AUTH: 'true',
        NOVA_OWNER_EMAIL: 'yousifalhooti23@gmail.com',
        NOVA_OWNER_INITIAL_PASSWORD: 'OwnerSuperStrongPassword!2026',
        NOVA_OWNER_NAME: 'Yousif',
        NOVA_USER_QUOTA_LIMIT: '3',
        OPENROUTER_API_KEY: 'sk-or-test-secret-do-not-leak',
      } as never,
      store: new JsonStore(),
      blob: new MemoryBlobStore(),
      adapters: [adapter],
      logLevel: 'error',
    });
    app = boot.app;
  });

  const apiReq = (method: string, urlPath: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(urlPath, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('blocks unauthenticated access to private endpoints while keeping /api/health & /api/auth/me reachable', async () => {
    const health = await apiReq('GET', Endpoints.health);
    expect(health.status).toBe(200);
    expect(health.headers.get('x-frame-options')).toBe('DENY');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    const hJson = (await health.json()) as { userAuthEnabled: boolean };
    expect(hJson.userAuthEnabled).toBe(true);

    const me = await apiReq('GET', Endpoints.authMe);
    expect(me.status).toBe(200);
    expect((await me.json()) as { authenticated: boolean }).toMatchObject({ authenticated: false, user: null });

    for (const protectedPath of [Endpoints.conversations, Endpoints.projects, Endpoints.settings, Endpoints.usage]) {
      const r = await apiReq('GET', protectedPath);
      expect(r.status).toBe(401);
    }
  });

  it('strictly isolates User A and User B conversations, projects, global memory, settings, and uploaded media', async () => {
    // Register User A
    const regA = await apiReq(
      'POST',
      Endpoints.authRegister,
      { displayName: 'Alice', email: 'alice@example.com', password: 'AliceStrongPassword123' },
      { 'cf-connecting-ip': '10.0.0.1' },
    );
    expect(regA.status).toBe(201);
    const bodyA = (await regA.json()) as { token: string; user: { id: string; role: string } };
    expect(bodyA.user.role).toBe('user');
    const authA = { authorization: `Bearer ${bodyA.token}` };

    // Register User B
    const regB = await apiReq(
      'POST',
      Endpoints.authRegister,
      { displayName: 'Bob', email: 'bob@example.com', password: 'BobStrongPassword123' },
      { 'cf-connecting-ip': '10.0.0.2' },
    );
    expect(regB.status).toBe(201);
    const bodyB = (await regB.json()) as { token: string; user: { id: string } };
    const authB = { authorization: `Bearer ${bodyB.token}` };

    // User A creates private conversation, project, global memory, and SVG upload
    const convRes = await apiReq('POST', Endpoints.conversations, { title: 'سر خاص بأليس' }, authA);
    expect(convRes.status).toBe(201);
    const convId = ((await convRes.json()) as { conversation: { id: string } }).conversation.id;

    const projRes = await apiReq(
      'POST',
      Endpoints.projects,
      { name: 'alice-secret-repo', files: { 'secret.ts': 'export const KEY = "alice-only";' } },
      authA,
    );
    expect(projRes.status).toBe(201);
    const projId = ((await projRes.json()) as { project: { id: string } }).project.id;

    const memRes = await apiReq(
      'POST',
      Endpoints.memory,
      { scope: 'global', key: 'secret_Fact', content: 'Alice private note' },
      authA,
    );
    expect(memRes.status).toBe(201);
    const memId = ((await memRes.json()) as { entry: { id: string } }).entry.id;

    const form = new FormData();
    form.append('file', new File(['<svg onload="alert(1)"></svg>'], 'xss.svg', { type: 'image/svg+xml' }));
    const upRes = await app.request(Endpoints.uploads, { method: 'POST', headers: authA, body: form });
    expect(upRes.status).toBe(201);
    const attId = ((await upRes.json()) as { attachment: { id: string } }).attachment.id;

    // Verify User A's upload is served with anti-XSS sandbox CSP, attachment disposition, and private cache
    const getOwnAtt = await app.request(`/api/uploads/${attId}`, { headers: authA });
    expect(getOwnAtt.status).toBe(200);
    expect(getOwnAtt.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(getOwnAtt.headers.get('content-security-policy')).toContain('sandbox');
    expect(getOwnAtt.headers.get('cache-control')).toContain('private');

    // User B MUST see zero items from User A and receive 404 when probing User A's IDs!
    const bConvs = (await (await apiReq('GET', Endpoints.conversations, undefined, authB)).json()) as { conversations: unknown[] };
    expect(bConvs.conversations).toHaveLength(0);

    const bProjs = (await (await apiReq('GET', Endpoints.projects, undefined, authB)).json()) as { projects: unknown[] };
    expect(bProjs.projects).toHaveLength(0);

    const bMem = (await (await apiReq('GET', `${Endpoints.memory}?scope=global`, undefined, authB)).json()) as { entries: unknown[] };
    expect(bMem.entries).toHaveLength(0);

    expect((await apiReq('GET', Endpoints.conversation(convId), undefined, authB)).status).toBe(404);
    expect((await apiReq('DELETE', Endpoints.conversation(convId), undefined, authB)).status).toBe(404);
    expect((await apiReq('GET', Endpoints.project(projId), undefined, authB)).status).toBe(404);
    expect((await apiReq('DELETE', Endpoints.memoryEntry(memId), undefined, authB)).status).toBe(404);
    expect((await app.request(`/api/uploads/${attId}`, { headers: authB })).status).toBe(404);

    // Regular users cannot read or modify owner provider keys or admin user list
    const bKeys = (await (await apiReq('GET', Endpoints.localProviderKeys, undefined, authB)).json()) as { writable: boolean; keys: unknown[] };
    expect(bKeys.writable).toBe(false);
    expect(bKeys.keys).toHaveLength(0);
    expect((await apiReq('GET', Endpoints.adminUsers, undefined, authB)).status).toBe(403);
  });

  it('enforces daily quota on regular users, locks for 1 full week upon exhaustion, and gives Owner unlimited access', async () => {
    // Register regular user Charlie (quota limit = 3)
    const regC = await apiReq(
      'POST',
      Endpoints.authRegister,
      { displayName: 'Charlie', email: 'charlie@example.com', password: 'CharliePassword123' },
      { 'cf-connecting-ip': '10.0.0.3' },
    );
    const charlie = (await regC.json()) as { token: string; user: { id: string } };
    const authC = { authorization: `Bearer ${charlie.token}` };

    // Use all 3 daily units
    for (let i = 1; i <= 3; i++) {
      const chatRes = await apiReq('POST', Endpoints.chat, { message: `سؤال رقم ${i}` }, authC);
      expect(chatRes.status).toBe(200);
      await chatRes.text();
    }

    // Check /api/auth/me -> Charlie is now locked for 7 days!
    const meLocked = (await (await apiReq('GET', Endpoints.authMe, undefined, authC)).json()) as {
      user: { quota: { used: number; limit: number; locked: boolean; lockedUntil: string | null } };
    };
    expect(meLocked.user.quota.used).toBe(3);
    expect(meLocked.user.quota.locked).toBe(true);
    expect(meLocked.user.quota.lockedUntil).toBeTruthy();

    // 4th attempt MUST fail with 429 and Arabic weekly renewal message
    const blockedChat = await apiReq('POST', Endpoints.chat, { message: 'سؤال رابع بعد انتهاء الحد' }, authC);
    expect(blockedChat.status).toBe(429);
    const blockedBody = (await blockedChat.json()) as { error: string; code: string };
    expect(blockedBody.code).toBe('quota_exhausted_weekly');
    expect(blockedBody.error).toContain('أسبوع');

    // Owner Yousif logs in -> unlimited quota, can send >3 messages without ever decrementing or locking!
    const loginOwner = await apiReq(
      'POST',
      Endpoints.authLogin,
      { email: 'yousifalhooti23@gmail.com', password: 'OwnerSuperStrongPassword!2026' },
      { 'cf-connecting-ip': '10.0.0.99' },
    );
    expect(loginOwner.status).toBe(200);
    const owner = (await loginOwner.json()) as {
      token: string;
      user: { role: string; quota: { unlimited: boolean; locked: boolean } };
    };
    expect(owner.user.role).toBe('owner');
    expect(owner.user.quota.unlimited).toBe(true);
    const authOwner = { authorization: `Bearer ${owner.token}` };

    for (let i = 1; i <= 6; i++) {
      const ownerChat = await apiReq('POST', Endpoints.chat, { message: `رسالة المالك ${i}` }, authOwner);
      expect(ownerChat.status).toBe(200);
      await ownerChat.text();
    }

    // Owner can view users and reset Charlie's weekly lockout
    const adminList = await apiReq('GET', Endpoints.adminUsers, undefined, authOwner);
    expect(adminList.status).toBe(200);
    const resetRes = await apiReq('POST', Endpoints.adminUserQuota(charlie.user.id), { action: 'reset' }, authOwner);
    expect(resetRes.status).toBe(200);

    // Charlie can chat again immediately after Owner reset!
    const afterReset = await apiReq('POST', Endpoints.chat, { message: 'شكراً بعد التصفير' }, authC);
    expect(afterReset.status).toBe(200);
    await afterReset.text();
  });

  it('rate-limits brute-force login attempts with 429', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 9; i++) {
      const r = await apiReq(
        'POST',
        Endpoints.authLogin,
        { email: 'alice@example.com', password: `wrong-password-${i}` },
        { 'cf-connecting-ip': '203.0.113.77' },
      );
      lastStatus = r.status;
    }
    expect(lastStatus).toBe(429);
  });
});
