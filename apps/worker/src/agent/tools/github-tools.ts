import { truncate } from '@nova/shared';
import { isSafeExternalUrl, performSafeJinaFetch } from './web-search.js';
import { reqStr, type Tool, type ToolContext, type ToolResult } from './types.js';

export interface GitHubRepoSummary {
  name: string;
  fullName: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  defaultBranch: string;
  files: string[];
  readmeExcerpt?: string;
}

/**
 * Inspects a public GitHub repository using the GitHub Public REST API
 * and Jina Reader. 100% free with zero keys and zero local filesystem access.
 */
export async function inspectGitHubRepo(repoTarget: string, maxFiles = 30): Promise<GitHubRepoSummary> {
  let target = repoTarget.trim().replace(/\/$/, '');
  const urlMatch = /github\.com\/([^/]+)\/([^/]+)/i.exec(target);
  let owner = '';
  let repo = '';
  if (urlMatch) {
    owner = urlMatch[1];
    repo = urlMatch[2].replace(/\.git$/i, '');
  } else {
    const parts = target.split('/');
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts[1];
    }
  }

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository target: "${repoTarget}". Format must be owner/repo or https://github.com/owner/repo`);
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);

  let repoData: any = null;
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'NOVA-AI-Cloud/0.5.0',
      },
      signal: ac.signal,
    });
    if (resp.ok) {
      repoData = await resp.json();
    }
  } catch {
    /* proceed with fallback */
  } finally {
    clearTimeout(timer);
  }

  const defaultBranch = repoData?.default_branch || 'main';
  const description = repoData?.description || 'Public GitHub Repository';
  const stars = Number(repoData?.stargazers_count ?? 0);
  const forks = Number(repoData?.forks_count ?? 0);
  const language = repoData?.language || 'Unknown';

  // Fetch tree listing
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
  const treeAc = new AbortController();
  const treeTimer = setTimeout(() => treeAc.abort(), 8000);
  let files: string[] = [];
  try {
    const treeResp = await fetch(treeUrl, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'NOVA-AI-Cloud/0.5.0' },
      signal: treeAc.signal,
    });
    if (treeResp.ok) {
      const treeJson = (await treeResp.json()) as { tree?: { path: string; type: string }[] };
      if (Array.isArray(treeJson?.tree)) {
        files = treeJson.tree
          .filter((item) => item.type === 'blob')
          .map((item) => item.path)
          .slice(0, maxFiles);
      }
    }
  } catch {
    /* fallback to jina */
  } finally {
    clearTimeout(treeTimer);
  }

  // Fetch README via Jina Reader
  let readmeExcerpt = '';
  try {
    const readmeJina = await performSafeJinaFetch(`https://github.com/${owner}/${repo}`, 4000);
    readmeExcerpt = readmeJina.content;
  } catch {
    /* non-critical */
  }

  return {
    name: repo,
    fullName: `${owner}/${repo}`,
    description,
    stars,
    forks,
    language,
    defaultBranch,
    files,
    readmeExcerpt,
  };
}

export const githubRepoInspectTool: Tool = {
  descriptor: {
    name: 'github_repo_inspect',
    description:
      'Inspect any public GitHub repository: fetches metadata, stars, default branch, directory file tree, and README content in real time.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'GitHub repository in format "owner/repo" or full URL "https://github.com/owner/repo"',
        },
      },
      required: ['repo'],
    },
  },
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const r = reqStr(args, 'repo');
    if (!r.ok) return { ok: false, output: r.error };

    try {
      ctx.log.info('inspecting github repo', { repo: r.value });
      const summary = await inspectGitHubRepo(r.value);
      const fileTree = summary.files.length > 0 ? summary.files.map((f) => `  - ${f}`).join('\n') : '  (file tree unavailable)';

      const output = [
        `### Repository: [${summary.fullName}](https://github.com/${summary.fullName})`,
        `**Description:** ${summary.description}`,
        `**Stars:** ★ ${summary.stars.toLocaleString()} | **Forks:** ⑂ ${summary.forks.toLocaleString()} | **Language:** ${summary.language}`,
        `**Default Branch:** \`${summary.defaultBranch}\``,
        '',
        `#### File Tree Preview (${summary.files.length} files):`,
        fileTree,
        '',
        summary.readmeExcerpt ? `#### README / Project Overview:\n${truncate(summary.readmeExcerpt, 3000)}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        ok: true,
        output,
        meta: { repo: summary.fullName, stars: summary.stars, filesCount: summary.files.length },
      };
    } catch (err) {
      return { ok: false, output: `GitHub inspection error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
