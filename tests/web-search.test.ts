import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl, webSearchTool, githubSearchTool, webFetchTool } from '../apps/worker/src/agent/tools/web-search.js';
import { detectWebSearchIntent } from '../apps/worker/src/routes/chat.js';

describe('Safe Web & GitHub Search (Cloud Sandbox Isolation)', () => {
  it('blocks private, loopback, and local network URLs for strict SSRF protection', () => {
    // Loopback
    expect(isSafeExternalUrl('http://127.0.0.1:8080')).toBe(false);
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(false);
    expect(isSafeExternalUrl('http://0.0.0.0')).toBe(false);
    expect(isSafeExternalUrl('http://[::1]')).toBe(false);

    // Private IPv4 ranges
    expect(isSafeExternalUrl('http://10.0.0.5/api')).toBe(false);
    expect(isSafeExternalUrl('https://192.168.1.1/admin')).toBe(false);
    expect(isSafeExternalUrl('http://172.16.0.10/')).toBe(false);
    expect(isSafeExternalUrl('http://172.31.255.255/')).toBe(false);

    // Cloud metadata service
    expect(isSafeExternalUrl('http://169.254.169.254/latest/meta-data')).toBe(false);

    // Local hostnames
    expect(isSafeExternalUrl('http://my-laptop.local/secret')).toBe(false);
    expect(isSafeExternalUrl('http://db.internal')).toBe(false);

    // Non-http schemes
    expect(isSafeExternalUrl('file:///C:/Users/Yousif/secret.txt')).toBe(false);
    expect(isSafeExternalUrl('ftp://ftp.test.com')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);

    // Valid public internet URLs MUST be allowed
    expect(isSafeExternalUrl('https://github.com/torvalds/linux')).toBe(true);
    expect(isSafeExternalUrl('https://en.wikipedia.org/wiki/Oman')).toBe(true);
    expect(isSafeExternalUrl('https://developer.mozilla.org/')).toBe(true);
  });

  it('detects Arabic and English search and GitHub intents accurately', () => {
    const r1 = detectWebSearchIntent('ابحث في النت عن أفضل متاجر العطور في عمان');
    expect(r1.isSearch).toBe(true);
    expect(r1.isGitHub).toBe(false);
    expect(r1.query).toContain('عطور');

    const r2 = detectWebSearchIntent('شوف من جيت هاب عن مكتبة سلايدشو ثلاثية الأبعاد');
    expect(r2.isSearch).toBe(true);
    expect(r2.isGitHub).toBe(true);
    expect(r2.query).toContain('ثلاثية الأبعاد');

    const r3 = detectWebSearchIntent('search github for nextjs dashboard template');
    expect(r3.isSearch).toBe(true);
    expect(r3.isGitHub).toBe(true);
    expect(r3.query).toContain('nextjs dashboard template');

    const r4 = detectWebSearchIntent('ابحث في قوقل عن آخر أخبار الذكاء الاصطناعي 2026');
    expect(r4.isSearch).toBe(true);
    expect(r4.isGitHub).toBe(false);

    const r5 = detectWebSearchIntent('برزنتيشن عن الطاقة المتجددة في سلطنة عمان');
    expect(r5.isSearch).toBe(true);
    expect(r5.query).toContain('الطاقة المتجددة');

    const r6 = detectWebSearchIntent('مرحبا كيف حالك اليوم');
    expect(r6.isSearch).toBe(false);
  });

  it('exposes safe read-only tool descriptors', () => {
    expect(webSearchTool.descriptor.name).toBe('web_search');
    expect(webSearchTool.descriptor.risk).toBe('read-only');

    expect(githubSearchTool.descriptor.name).toBe('github_search');
    expect(githubSearchTool.descriptor.risk).toBe('read-only');

    expect(webFetchTool.descriptor.name).toBe('web_fetch');
    expect(webFetchTool.descriptor.risk).toBe('read-only');
  });
});
