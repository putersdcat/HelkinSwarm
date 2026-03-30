import { toolRegistry } from '../tools/toolRegistry.js';
import type { ToolDefinition } from '../llm/foundryClient.js';

export type DeterministicFollowUpToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

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

function splitRecipients(raw: string): string[] {
  return raw
    .split(/,|\sand\s/i)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseQuotedSendEmailIntent(userMessage: string): DeterministicFollowUpToolCall | null {
  const match = userMessage.match(
    /send an? email to\s+(.+?)\s+with subject\s+["“'`](.+?)["”'`]\s+and body\s+["“'`](.+?)["”'`]/i,
  );

  if (!match) return null;

  const [, rawRecipients, subject, body] = match;
  const to = splitRecipients(rawRecipients);
  if (to.length === 0 || !subject.trim() || !body.trim()) {
    return null;
  }

  return {
    name: 'outlook_send_email',
    arguments: {
      to,
      subject: subject.trim(),
      body: body.trim(),
      bodyType: 'text',
    },
  };
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

  const looksLikeCalendarCreateIntent =
    /(calendar|meeting|appointment|event)/.test(normalized)
    && /(create|add|schedule|book|set up|put)/.test(normalized);

  if (looksLikeCalendarCreateIntent && toolNames.has('outlook_create_calendar_event')) {
    return { type: 'function', function: { name: 'outlook_create_calendar_event' } };
  }

  return null;
}

export function synthesizeDeterministicFollowUpToolCall(
  userMessage: string,
  tools: ToolDefinition[] | null | undefined,
): DeterministicFollowUpToolCall | null {
  if (!tools || tools.length === 0) return null;

  const toolNames = new Set(tools.map((tool) => tool.function.name));

  if (toolNames.has('outlook_send_email')) {
    return parseQuotedSendEmailIntent(userMessage);
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

export function isDiscoveryOnlyDeadEnd(toolResults: ToolResult[] | null | undefined): boolean {
  if (!toolResults || toolResults.length === 0) return false;

  const successfulToolNames = toolResults
    .filter((result) => result.success)
    .map((result) => result.toolName);

  return successfulToolNames.includes('helkin_skill_search')
    && successfulToolNames.every((toolName) => isCoreTool(toolName));
}

export function buildDiscoveryDeadEndResponse(userMessage: string): string {
  const normalized = userMessage.toLowerCase();

  if (/(calendar|meeting|appointment|event|schedule)/.test(normalized)) {
    return 'I searched the installed skills for a calendar action, but I did not reach an executable calendar tool from discovery, so I have not created an event. Please restate the request with the event subject plus the date and time, and include any attendees or reminder details you want.';
  }

  return 'I searched the installed skills for a matching action, but I did not reach an executable tool from discovery, so I have not changed anything yet. Please restate the request with the exact action and the key details you want me to use.';
}

function isDiscoverySearchResult(value: unknown): value is DiscoverySearchResultShape {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['tools']) || Array.isArray(candidate['skills']);
}