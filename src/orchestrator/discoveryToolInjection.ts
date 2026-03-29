import { toolRegistry } from '../tools/toolRegistry.js';
import type { ToolDefinition } from '../llm/foundryClient.js';

type ToolResult = {
  toolName: string;
  success: boolean;
  result?: unknown;
};

type DiscoverySearchResultShape = {
  tools?: Array<{ name?: string }>;
  skills?: Array<{ recommendedEntryTools?: string[] }>;
};

function isCoreTool(name: string): boolean {
  return name.startsWith('helkin_');
}

export function getDiscoveryFirstToolSchemas(): ToolDefinition[] {
  return toolRegistry
    .toFunctionSchemas()
    .filter((tool) => isCoreTool(tool.function.name));
}

export function getDiscoveryFirstToolDefinitions(): Array<{ name: string; description: string }> {
  return toolRegistry
    .getSafetyFiltered()
    .filter((tool) => isCoreTool(tool.name))
    .map((tool) => ({ name: tool.name, description: tool.description }));
}

export function shouldForceDiscoveryToolSearch(userMessage: string): boolean {
  const normalized = userMessage.toLowerCase();
  return /(send|reply|email|mail|calendar|meeting|schedule|github|repo|issue|pull request|weather|web search|search the web)/.test(normalized);
}

export function getForcedDiscoveryFollowUpToolChoice(
  userMessage: string,
  tools: ToolDefinition[] | null | undefined,
): { type: 'function'; function: { name: string } } | null {
  if (!tools || tools.length === 0) return null;

  const normalized = userMessage.toLowerCase();
  const toolNames = new Set(tools.map((tool) => tool.function.name));

  if (/(send|email|mail)/.test(normalized) && toolNames.has('outlook_send_email')) {
    return { type: 'function', function: { name: 'outlook_send_email' } };
  }

  if (/(reply|respond)/.test(normalized) && toolNames.has('outlook_reply_to_latest_email')) {
    return { type: 'function', function: { name: 'outlook_reply_to_latest_email' } };
  }

  return null;
}

export function deriveSelectiveFollowUpToolSchemas(
  toolResults: ToolResult[],
): ToolDefinition[] | null {
  const discoveryResult = toolResults.find((result) =>
    result.success && result.toolName === 'helkin_skill_search' && isDiscoverySearchResult(result.result),
  );

  if (!discoveryResult || !discoveryResult.result || !isDiscoverySearchResult(discoveryResult.result)) {
    return null;
  }

  const selectedNames = new Set<string>();
  for (const tool of discoveryResult.result.tools ?? []) {
    if (tool.name) {
      selectedNames.add(tool.name);
    }
  }
  for (const skill of discoveryResult.result.skills ?? []) {
    for (const toolName of skill.recommendedEntryTools ?? []) {
      selectedNames.add(toolName);
    }
  }

  if (selectedNames.size === 0) {
    return null;
  }

  return toolRegistry.toFunctionSchemas().filter((tool) =>
    isCoreTool(tool.function.name) || selectedNames.has(tool.function.name),
  );
}

function isDiscoverySearchResult(value: unknown): value is DiscoverySearchResultShape {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['tools']) || Array.isArray(candidate['skills']);
}