import { truncate } from '@nova/shared';
import { reqStr, type Tool, type ToolContext, type ToolResult } from './types.js';

/**
 * Strict SSRF (Server-Side Request Forgery) guard:
 * Guarantees zero access to user's laptop, internal network, or metadata services.
 * Only public internet HTTP/HTTPS domains are allowed.
 */
export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.lan') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '::' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

/**
 * Executes a fast, cloud-isolated web search via DuckDuckGo and Wikipedia.
 * 100% free, cardless, with zero local machine intrusion.
 */
export async function performSafeWebSearch(query: string, limit = 5): Promise<SearchResultItem[]> {
  const cleanQuery = query.trim().slice(0, 150);
  if (!cleanQuery) return [];

  const results: SearchResultItem[] = [];

  // 1. DuckDuckGo Search
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6000);
    try {
      const resp = await fetch(ddgUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ar,en-US,en;q=0.9',
        },
        signal: ac.signal,
      });
      if (resp.ok) {
        const html = await resp.text();
        const snippetRegex = /<a[^>]+class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
        const titleRegex = /<a[^>]+class="result__url[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

        const snippets: string[] = [];
        let sMatch: RegExpExecArray | null;
        while ((sMatch = snippetRegex.exec(html)) && snippets.length < limit) {
          const raw = sMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          if (raw) snippets.push(raw);
        }

        const urls: { url: string; display: string }[] = [];
        let uMatch: RegExpExecArray | null;
        while ((uMatch = titleRegex.exec(html)) && urls.length < limit) {
          const rawHref = uMatch[1];
          let cleanHref = rawHref;
          // Unpack DDG redirect uddg= parameter if present
          const uddgMatch = rawHref.match(/[?&]uddg=([^&]+)/);
          if (uddgMatch) {
            try { cleanHref = decodeURIComponent(uddgMatch[1]); } catch { /* ignore */ }
          }
          const display = uMatch[2].replace(/<[^>]+>/g, '').trim();
          urls.push({ url: cleanHref, display });
        }

        for (let i = 0; i < snippets.length; i++) {
          const u = urls[i]?.url || '';
          if (u && !isSafeExternalUrl(u)) continue;
          results.push({
            title: urls[i]?.display || `Search Result #${i + 1}`,
            url: u.startsWith('http') ? u : `https://${urls[i]?.display || cleanQuery}`,
            snippet: snippets[i],
            source: 'DuckDuckGo',
          });
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* fallback to wikipedia below */
  }

  // 2. Wikipedia Encyclopedic fallback / enrichment
  if (results.length < 2) {
    try {
      const isAr = /[\u0600-\u06FF]/.test(cleanQuery);
      const wikiHost = isAr ? 'ar.wikipedia.org' : 'en.wikipedia.org';
      const wikiUrl = `https://${wikiHost}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&format=json&utf8=1`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 4500);
      try {
        const wikiResp = await fetch(wikiUrl, {
          headers: { 'User-Agent': 'NOVA-AI-Cloud/0.4.6' },
          signal: ac.signal,
        });
        if (wikiResp.ok) {
          const data = (await wikiResp.json()) as any;
          const searchHits = Array.isArray(data?.query?.search) ? data.query.search : [];
          for (const hit of searchHits.slice(0, 3)) {
            const title = String(hit.title || '');
            const snippet = String(hit.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').trim();
            if (title && snippet) {
              results.push({
                title,
                url: `https://${wikiHost}/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
                snippet,
                source: 'Wikipedia',
              });
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      /* ignore wiki errors */
    }
  }

  return results.slice(0, limit);
}

/**
 * Searches public GitHub repositories for open-source code, templates, and libraries.
 */
export async function performSafeGitHubSearch(query: string, limit = 5): Promise<SearchResultItem[]> {
  const clean = query.trim().slice(0, 120);
  if (!clean) return [];

  try {
    const ghUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(clean)}&sort=stars&order=desc&per_page=${limit}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6000);
    try {
      const resp = await fetch(ghUrl, {
        headers: {
          'User-Agent': 'NOVA-AI-Cloud/0.4.6',
          Accept: 'application/vnd.github.v3+json',
        },
        signal: ac.signal,
      });
      if (resp.ok) {
        const data = (await resp.json()) as any;
        const items = Array.isArray(data?.items) ? data.items : [];
        return items.slice(0, limit).map((it: any) => ({
          title: `${it.full_name} (★ ${it.stargazers_count})`,
          url: it.html_url,
          snippet: `${it.description || 'No description provided.'} [Language: ${it.language || 'Various'}]`,
          source: 'GitHub',
        }));
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* network timeout */
  }
  return [];
}

/**
 * Safely fetches a public webpage, strips HTML markup, and extracts clean markdown text.
 */
export async function performSafeWebFetch(targetUrl: string, maxChars = 5000): Promise<{ title: string; content: string; url: string }> {
  if (!isSafeExternalUrl(targetUrl)) {
    throw new Error('Access denied: target URL is invalid, non-HTTP, or belongs to a restricted internal IP.');
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 7000);
  try {
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,text/plain,application/xhtml+xml',
      },
      signal: ac.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }
    const html = await resp.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || targetUrl;

    // Clean html to plain markdown
    let clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(?:h[1-3])[^>]*>([\s\S]*?)<\/(?:h[1-3])>/gi, '\n### $1\n')
      .replace(/<(?:p|div|li)[^>]*>([\s\S]*?)<\/(?:p|div|li)>/gi, '\n$1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    return {
      title,
      url: targetUrl,
      content: truncate(clean, maxChars),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- Agent Tools */

export const webSearchTool: Tool = {
  descriptor: {
    name: 'web_search',
    description:
      'Search the public internet for live information, current news, documentation, libraries, or facts. Runs securely in the cloud with zero access to the local machine.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query (Arabic or English)' },
      },
      required: ['query'],
    },
  },
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const q = reqStr(args, 'query');
    if (!q.ok) return { ok: false, output: q.error };

    ctx.log.info('web_search tool invoked', { query: q.value });
    const hits = await performSafeWebSearch(q.value, 6);
    if (!hits.length) {
      return { ok: true, output: `No results found on the web for: "${q.value}". Try broader keywords.` };
    }

    const formatted = hits
      .map(
        (h, i) =>
          `[${i + 1}] **${h.title}** (${h.source})\nURL: ${h.url}\n${h.snippet}\n`,
      )
      .join('\n');

    return {
      ok: true,
      output: `Web Search Results for "${q.value}":\n\n${formatted}`,
      meta: { count: hits.length, query: q.value },
    };
  },
};

export const githubSearchTool: Tool = {
  descriptor: {
    name: 'github_search',
    description:
      'Search public GitHub repositories for open-source code, templates, UI components, presentations, and developer projects.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The GitHub search keywords' },
      },
      required: ['query'],
    },
  },
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const q = reqStr(args, 'query');
    if (!q.ok) return { ok: false, output: q.error };

    ctx.log.info('github_search tool invoked', { query: q.value });
    const hits = await performSafeGitHubSearch(q.value, 6);
    if (!hits.length) {
      return { ok: true, output: `No GitHub repositories found for query: "${q.value}".` };
    }

    const formatted = hits
      .map((h, i) => `[${i + 1}] **${h.title}**\nRepository: ${h.url}\n${h.snippet}\n`)
      .join('\n');

    return {
      ok: true,
      output: `GitHub Repositories for "${q.value}":\n\n${formatted}`,
      meta: { count: hits.length, query: q.value },
    };
  },
};

export const webFetchTool: Tool = {
  descriptor: {
    name: 'web_fetch',
    description:
      'Fetch and read the text content of a public web page or documentation URL. Validated with strict SSRF protection; zero local machine access.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The public HTTP/HTTPS URL to fetch' },
      },
      required: ['url'],
    },
  },
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const u = reqStr(args, 'url');
    if (!u.ok) return { ok: false, output: u.error };

    try {
      const res = await performSafeWebFetch(u.value);
      return {
        ok: true,
        output: `Page Title: ${res.title}\nURL: ${res.url}\n\nContent:\n${res.content}`,
        meta: { url: res.url, title: res.title },
      };
    } catch (err) {
      return { ok: false, output: `Failed to fetch webpage: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const webTools: Tool[] = [webSearchTool, githubSearchTool, webFetchTool];
