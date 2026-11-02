import { truncate } from '@nova/shared';
import { isSafeExternalUrl, performSafeJinaFetch } from './web-search.js';
import { reqStr, type Tool, type ToolContext, type ToolResult } from './types.js';

/**
 * Extracts YouTube video id from various YouTube URL formats
 */
export function extractYouTubeVideoId(input: string): string | null {
  const clean = input.trim();
  const regExp = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;
  const match = clean.match(regExp);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  return null;
}

export const youtubeSummarizeTool: Tool = {
  descriptor: {
    name: 'youtube_summarize',
    description:
      'Extract content, transcript, key topics, and metadata from any public YouTube video URL or ID without paid keys.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The YouTube video URL (e.g. https://www.youtube.com/watch?v=... or https://youtu.be/...)',
        },
      },
      required: ['url'],
    },
  },
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const u = reqStr(args, 'url');
    if (!u.ok) return { ok: false, output: u.error };

    const videoId = extractYouTubeVideoId(u.value);
    if (!videoId) {
      return { ok: false, output: `Invalid YouTube URL or video ID: "${u.value}". Please provide a valid YouTube link.` };
    }

    const standardUrl = `https://www.youtube.com/watch?v=${videoId}`;
    ctx.log.info('summarizing youtube video', { videoId, standardUrl });

    // 1. Fetch metadata via YouTube oEmbed (Free official endpoint)
    let title = `YouTube Video (${videoId})`;
    let author = 'Unknown Creator';
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(standardUrl)}&format=json`;
      const oResp = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'NOVA-AI-Cloud/0.5.0' },
        signal: AbortSignal.timeout(4500),
      });
      if (oResp.ok) {
        const oData = (await oResp.json()) as { title?: string; author_name?: string };
        if (oData.title) title = oData.title;
        if (oData.author_name) author = oData.author_name;
      }
    } catch {
      /* continue */
    }

    // 2. Fetch video transcript / description using Jina Reader
    let contentExcerpt = '';
    try {
      const jina = await performSafeJinaFetch(standardUrl, 6000);
      contentExcerpt = jina.content;
    } catch {
      /* continue */
    }

    const output = [
      `### [${title}](${standardUrl})`,
      `**Creator:** ${author} | **Video ID:** \`${videoId}\``,
      '',
      contentExcerpt
        ? `#### Video Content & Transcript Outline:\n${truncate(contentExcerpt, 4500)}`
        : '*(Direct transcript extraction unavailable; summarize using video metadata and context)*',
      '',
      `[Watch on YouTube](${standardUrl})`,
    ].join('\n');

    return {
      ok: true,
      output,
      meta: { videoId, title, author },
    };
  },
};
