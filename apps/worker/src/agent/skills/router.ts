import { BUILTIN_SKILLS, type NovaSkill } from '@nova/shared';
import { type Tool } from '../tools/types.js';
import { webSearchTool, githubSearchTool, webFetchTool } from '../tools/web-search.js';
import { githubRepoInspectTool } from '../tools/github-tools.js';
import { youtubeSummarizeTool, extractYouTubeVideoId } from '../tools/youtube-tools.js';
import { mathCalculateTool } from '../tools/math-tools.js';

export interface SkillRoutingResult {
  matchedSkills: NovaSkill[];
  activeTools: Tool[];
  systemPromptAdditions: string[];
}

const TOOL_REGISTRY: Record<string, Tool> = {
  web_search: webSearchTool,
  github_search: githubSearchTool,
  web_fetch: webFetchTool,
  github_repo_inspect: githubRepoInspectTool,
  youtube_summarize: youtubeSummarizeTool,
  math_calculate: mathCalculateTool,
};

/**
 * Lightweight Intent Classifier & Dynamic Skill Router:
 * Dynamically selects ONLY the relevant skills and tool definitions for the current turn,
 * saving 1,500+ tokens and preventing context window overflow.
 */
export function classifySkillIntent(
  message: string,
  userSelectedSkillIds?: string[],
  customSkills: NovaSkill[] = [],
): SkillRoutingResult {
  const m = message.trim();
  const low = m.toLowerCase();

  const allSkills = [...BUILTIN_SKILLS, ...customSkills];
  const matchedSkillIds = new Set<string>();

  // 1. Respect any skills manually selected or toggled by the user in UI
  if (Array.isArray(userSelectedSkillIds) && userSelectedSkillIds.length > 0) {
    for (const id of userSelectedSkillIds) {
      if (allSkills.some((s) => s.id === id)) {
        matchedSkillIds.add(id);
      }
    }
  }

  // 2. Autonomous Intent Detection (Zero-cost regex & keyword classifier)

  // YouTube detection
  if (extractYouTubeVideoId(m) || /youtube\.com|youtu\.be|فيديو\s+يوتيوب|لخص\s+اليوتيوب|مقطع\s+يوتيوب/i.test(low)) {
    matchedSkillIds.add('youtube-summarizer');
  }

  // GitHub & Repository detection
  if (
    /github\.com\/[^\s]+|مستودع|ريبو|git\s+repo|github\s+repo|كود\s+من\s+جت\s*هاب|ابحث\s+في\s+جت\s*هاب|انسبكت|مشروع\s+مفتوح\s+المصدر/i.test(
      low,
    )
  ) {
    matchedSkillIds.add('github-explorer');
  }

  // Math, Physics & Calculation detection
  if (
    /احسب|معادل[ةه]|رياضيات|حساب\s+المثلثات|كم\s+يساوي|احسب\s+لي|calculate|solve\s+math|equation|sqrt\(|sin\(|cos\(/i.test(
      low,
    )
  ) {
    matchedSkillIds.add('math-data-analyst');
  }

  // Diagrams & Architecture visualizer (Mermaid)
  if (
    /مخطط|رسم\s+بياني|معماري[ةه]|flowchart|diagram|mermaid|mindmap|sequence\s+diagram|شجرة\s+نظام|خريطة\s+ذهني[ةه]|هيكل\s+النظام/i.test(
      low,
    )
  ) {
    matchedSkillIds.add('architecture-diagrams');
  }

  // Interactive Code Canvas & Sandbox (Artifacts)
  if (
    /صمم\s+موقع|ابني\s+موقع|موقع\s+تجريبي|واجه[ةه]\s+تفاعلي[ةه]|لعب[ةه]|canvas|three\.js|interactive\s+widget|صفحة\s+ويب/i.test(
      low,
    )
  ) {
    matchedSkillIds.add('code-canvas');
  }

  // Live Web Search & Grounding
  if (
    /ابحث\s+في\s+الويب|أخبار\s+اليوم|آخر\s+تحديث|سعر\s+اليوم|مباراة\s+اليوم|web\s+search|latest\s+news|what\s+happened\s+in/i.test(
      low,
    )
  ) {
    matchedSkillIds.add('live-web-search');
  }

  const matchedSkills: NovaSkill[] = [];
  const toolSet = new Set<Tool>();
  const systemPromptAdditions: string[] = [];

  for (const id of matchedSkillIds) {
    const skill = allSkills.find((s) => s.id === id);
    if (!skill) continue;
    matchedSkills.push(skill);

    if (skill.systemPrompt) {
      systemPromptAdditions.push(`[Active Skill: ${skill.name}]\n${skill.systemPrompt}`);
    }

    if (Array.isArray(skill.tools)) {
      for (const toolName of skill.tools) {
        const tool = TOOL_REGISTRY[toolName];
        if (tool) toolSet.add(tool);
      }
    }
  }

  return {
    matchedSkills,
    activeTools: [...toolSet],
    systemPromptAdditions,
  };
}
