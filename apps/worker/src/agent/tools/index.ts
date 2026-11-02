import type { ToolDescriptor } from '@nova/shared';
import { fileTools } from './files.js';
import { gitTools } from './git-tools.js';
import { memoryTools } from './memory.js';
import { planningTools } from './planning.js';
import { terminalTools } from './terminal.js';
import { webTools } from './web-search.js';
import { githubRepoInspectTool } from './github-tools.js';
import { youtubeSummarizeTool } from './youtube-tools.js';
import { mathCalculateTool } from './math-tools.js';
import type { Tool } from './types.js';

export const HUB_TOOLS: Tool[] = [githubRepoInspectTool, youtubeSummarizeTool, mathCalculateTool];

/** Every tool the agent may call, in one registry. */
export const TOOLS: Tool[] = [...planningTools, ...fileTools, ...terminalTools, ...gitTools, ...memoryTools, ...webTools, ...HUB_TOOLS];

export const TOOL_MAP = new Map<string, Tool>(TOOLS.map((t) => [t.descriptor.name, t]));

/** JSON-schema tool list handed to the model. */
export function toolSpecs(names?: string[]): { name: string; description: string; parameters: Record<string, unknown> }[] {
  const list = names ? TOOLS.filter((t) => names.includes(t.descriptor.name)) : TOOLS;
  return list.map((t) => ({ name: t.descriptor.name, description: t.descriptor.description, parameters: t.descriptor.parameters }));
}

export function descriptor(name: string): ToolDescriptor | undefined {
  return TOOL_MAP.get(name)?.descriptor;
}

export * from './types.js';
export { applyChange } from './files.js';
export { performSafeWebSearch, performSafeGitHubSearch, performSafeWebFetch } from './web-search.js';
export { inspectGitHubRepo, githubRepoInspectTool } from './github-tools.js';
export { youtubeSummarizeTool } from './youtube-tools.js';
export { evaluateSafeMath, mathCalculateTool } from './math-tools.js';
