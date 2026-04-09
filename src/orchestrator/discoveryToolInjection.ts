import { toolRegistry } from '../tools/toolRegistry.js';
import type { ToolDefinition } from '../llm/foundryClient.js';
import { getDiscoveryCapabilityGroup, getDiscoverySkill } from '../capabilities/skillDiscoveryIndex.js';
import type { ModelAffinity } from '../capabilities/manifestSchema.js';
import type { RuntimeAssetReference } from '../integrations/runtimeAssetStore.js';

export type DeterministicFollowUpToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

type RoutingMessageContext = {
  quotedText?: string;
  recentUserText?: string;
  recentAssistantText?: string;
};

type ToolResult = {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
};

type DiscoverySearchResultShape = {
  tools?: Array<{ name?: string; domain?: string }>;
  capabilityGroups?: Array<{ id?: string; toolNames?: string[] }>;
  skills?: Array<{
    domain?: string;
    recommendedEntryTools?: string[];
    operationalState?: string;
  }>;
};

type ReadOnlyDiscoverySearchResultShape = {
  command?: string;
  query?: string;
  capabilityGroups?: Array<{
    id?: string;
    domain?: string;
    displayName?: string;
    shortDescription?: string;
    operationalState?: string;
    toolCount?: number;
  }>;
  tools?: Array<{
    name?: string;
    domain?: string;
    description?: string;
    risk?: string;
    skillOperationalState?: string;
  }>;
  skills?: Array<{
    domain?: string;
    displayName?: string;
    shortDescription?: string;
    operationalState?: string;
  }>;
};

type DiscoveryModelOverride = 'primary' | 'secondary';

function isCoreTool(name: string): boolean {
  return name.startsWith('helkin_');
}

function isNonChatRecoverableSkillState(state: string | undefined): boolean {
  return state === 'operator-setup-required' || state === 'blocked';
}

function splitRecipients(raw: string): string[] {
  return raw
    .split(/,|\sand\s/i)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function extractEmailAddresses(raw: string): string[] {
  return Array.from(raw.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi))
    .map((match) => match[0]?.trim())
    .filter((value): value is string => !!value);
}

export function stripValidationNoise(userMessage: string): string {
  return userMessage
    .replace(/^\/(?:heavy|light)\s+/i, '')
    .replace(/^\s*\d+\s+(?:(?:final|conclusive|profile|trace|deploy-restart)\s+)*(?:proof|probe)\s+(?:primary|secondary)\s*:\s*/i, '')
    .replace(/\bthis is issue\s+\d+.*$/i, '')
    .trim();
}

function stripInjectedRoutingContext(userMessage: string): string {
  return userMessage
    .replace(/\n+\[Quoted context\][\s\S]*$/i, '')
    .replace(/\n+\[Recent user context\][\s\S]*$/i, '')
    .replace(/\n+\[Recent assistant context\][\s\S]*$/i, '')
    .trim();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function containsEmailAddress(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

function hasMailboxMessageContext(normalizedMessage: string): boolean {
  if (/(outlook|mailbox|email|emails|mail|attachment|attachments|messageid|message id)/.test(normalizedMessage)) {
    return true;
  }

  return /\bmessages?\b/.test(normalizedMessage)
    && /(latest|recent|inbox|subject|sender|from\b|attachment|attachments|mailbox|outlook|email|mail)/.test(normalizedMessage);
}

function hasOutlookReplyIntent(normalizedMessage: string): boolean {
  return /\b(reply|respond)\b/.test(normalizedMessage)
    && hasMailboxMessageContext(normalizedMessage);
}

function hasOutlookSendIntent(normalizedMessage: string): boolean {
  return /\b(send|compose|draft|forward|email|mail)\b/.test(normalizedMessage)
    && (hasMailboxMessageContext(normalizedMessage) || containsEmailAddress(normalizedMessage));
}

export function parseExactReplyInstruction(userMessage: string): string | null {
  const cleaned = stripValidationNoise(userMessage);
  const match = cleaned.match(/^(?:reply|respond|say)\s+with\s+exactly:\s*(.+)$/is);
  if (!match?.[1]) {
    return null;
  }

  const exactText = match[1].trim();
  return exactText.length > 0 ? exactText : null;
}

function isExecutionProofPrompt(userMessage: string): boolean {
  const normalized = stripValidationNoise(userMessage).toLowerCase();
  return /(functional test|simple test|smoke test|test (?:it|this|that|the skill|the tool)|verify (?:it|this|that|the skill|the tool)|prove (?:it|this|that)|demonstrate|output the results|show the results)/.test(normalized);
}

export function buildContextAwareRoutingMessage(
  userMessage: string,
  context?: RoutingMessageContext,
): string {
  const cleaned = collapseWhitespace(userMessage);
  if (!isExecutionProofPrompt(cleaned)) {
    return cleaned;
  }

  const hints: string[] = [];
  if (context?.quotedText) {
    hints.push(`[Quoted context]\n${context.quotedText}`);
  }
  if (context?.recentUserText) {
    hints.push(`[Recent user context]\n${context.recentUserText}`);
  }
  if (context?.recentAssistantText) {
    hints.push(`[Recent assistant context]\n${context.recentAssistantText}`);
  }

  return hints.length > 0
    ? `${cleaned}\n\n${hints.join('\n\n')}`
    : cleaned;
}

function findExplicitToolNameMention(normalizedMessage: string, toolNames: Set<string>): string | undefined {
  for (const toolName of toolNames) {
    if (normalizedMessage.includes(toolName.toLowerCase())) {
      return toolName;
    }
  }

  return undefined;
}

function parseScalarExactToolArgumentValue(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim();
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

function parseExactToolArgumentSegment(argumentSegment: string): Record<string, unknown> {
  const parsedArgs: Record<string, unknown> = {};
  const assignmentPattern = /([a-zA-Z][a-zA-Z0-9_]*)\s+(?:"([^"]*)"|'([^']*)'|`([^`]*)`|(true|false|-?\d+(?:\.\d+)?))/g;

  for (const match of argumentSegment.matchAll(assignmentPattern)) {
    const key = match[1]?.trim();
    const rawValue = match[2] ?? match[3] ?? match[4] ?? match[5];
    if (!key || rawValue === undefined) {
      continue;
    }

    parsedArgs[key] = parseScalarExactToolArgumentValue(rawValue);
  }

  return parsedArgs;
}

function parseExactToolRequestedFields(userMessage: string): string[] {
  const cleaned = stripValidationNoise(userMessage);
  const fieldMatch = cleaned.match(/return only compact json with\s+(.+)$/i);
  if (!fieldMatch?.[1]) {
    return [];
  }

  return fieldMatch[1]
    .replace(/[.]\s*$/g, '')
    .split(/,|\band\b/i)
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

function hasExplicitExactToolRequest(userMessage: string): boolean {
  const cleaned = stripValidationNoise(userMessage);
  return /use the exact tool\s+[a-z][a-z0-9_]*/i.test(cleaned);
}

function getValueAtPath(source: unknown, path: string): unknown {
  const parts = path.split('.').filter((part) => part.length > 0);
  let current: unknown = source;

  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function setValueAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter((part) => part.length > 0);
  if (parts.length === 0) {
    return;
  }

  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]!] = value;
}

export function synthesizeExactToolCall(
  userMessage: string,
  tools: ToolDefinition[] | null | undefined,
): DeterministicFollowUpToolCall | null {
  if (!tools || tools.length === 0) return null;

  const cleaned = stripValidationNoise(userMessage);
  const match = cleaned.match(/use the exact tool\s+([a-z][a-z0-9_]*)\s+with\s+(.+?)(?:\.\s*return only\b|$)/i);
  if (!match) {
    return null;
  }

  const toolName = match[1]?.trim();
  const argumentSegment = match[2]?.trim();
  if (!toolName || !argumentSegment) {
    return null;
  }

  const availableToolNames = new Set(tools.map((tool) => tool.function.name));
  if (!availableToolNames.has(toolName)) {
    return null;
  }

  const argumentsObject = parseExactToolArgumentSegment(argumentSegment);
  if (Object.keys(argumentsObject).length === 0) {
    return null;
  }

  return {
    name: toolName,
    arguments: argumentsObject,
  };
}

function parseDeterministicSkillVerificationIntent(
  userMessage: string,
  toolNames: Set<string>,
): DeterministicFollowUpToolCall | null {
  const cleanedMessage = stripValidationNoise(userMessage);
  const normalizedMessage = cleanedMessage.toLowerCase();

  if (!isExecutionProofPrompt(cleanedMessage)) {
    return null;
  }

  const mentionsGraphEnterprise = /(graphenterprise|microsoft graph enterprise mcp|graphenterprise_suggest_queries|graphenterprise_get|graphenterprise_list_properties)/.test(normalizedMessage);
  if (mentionsGraphEnterprise) {
    if (toolNames.has('graphenterprise_list_properties')) {
      return {
        name: 'graphenterprise_list_properties',
        arguments: { entity: 'user' },
      };
    }

    if (toolNames.has('graphenterprise_suggest_queries')) {
      return {
        name: 'graphenterprise_suggest_queries',
        arguments: {
          question: 'Show a safe read-only Microsoft Graph tenant reporting query for user counts.',
        },
      };
    }
  }

  const mentionsOutlook = /(outlook|mailbox|email|attachments?)/.test(normalizedMessage);
  if (mentionsOutlook && toolNames.has('outlook_search_emails')) {
    return {
      name: 'outlook_search_emails',
      arguments: {
        query: 'hasAttachment:true',
        folder: 'inbox',
        top: 5,
      },
    };
  }

  return null;
}

export function synthesizeDeterministicReadOnlyInitialToolCall(
  userMessage: string,
  tools: ToolDefinition[] | null | undefined,
): DeterministicFollowUpToolCall | null {
  if (!tools || tools.length === 0) return null;
  if (isReadOnlyDiscoveryRequest(userMessage)) return null;

  const toolNames = new Set(tools.map((tool) => tool.function.name));

  if (toolNames.has('outlook_search_emails')) {
    const mailboxSearchIntent = parseDeterministicOutlookSearchIntent(userMessage);
    if (mailboxSearchIntent) {
      return mailboxSearchIntent;
    }
  }

  return parseDeterministicSkillVerificationIntent(userMessage, toolNames);
}

export function buildDeterministicExactToolResponse(
  userMessage: string,
  toolResults: ToolResult[] | null | undefined,
): string | null {
  if (!hasExplicitExactToolRequest(userMessage)) {
    return null;
  }

  if (!toolResults || toolResults.length === 0) {
    return null;
  }

  const requestedFields = parseExactToolRequestedFields(userMessage);
  const primaryResult = toolResults[0];
  if (!primaryResult) {
    return null;
  }

  const baseResult = primaryResult.success
    ? primaryResult.result
    : {
        status: 'error',
        error: primaryResult.error ?? `Tool ${primaryResult.toolName} failed.`,
      };

  if (requestedFields.length === 0) {
    return JSON.stringify(baseResult ?? {});
  }

  const compact: Record<string, unknown> = {};
  for (const field of requestedFields) {
    const value = getValueAtPath(baseResult, field);
    if (value !== undefined) {
      setValueAtPath(compact, field, value);
    }
  }

  return JSON.stringify(Object.keys(compact).length > 0 ? compact : (baseResult ?? {}));
}

export function isReadOnlyDiscoveryRequest(userMessage: string): boolean {
  const normalized = stripValidationNoise(stripInjectedRoutingContext(userMessage)).toLowerCase();
  // #578: Teams quoted-reply previews can leak the previous discovery-only bot
  // reply into the new raw user message. If the current turn is asking for an
  // execution proof, do not let stale quoted discovery phrasing collapse the
  // turn back into a read-only helkin_skill_search request.
  if (isExecutionProofPrompt(normalized)) {
    return false;
  }

  const hasReadOnlyConstraint = /(discovery[- ]only|read[- ]only|do not execute|don't execute|without executing|non-discovery tools)/.test(normalized);
  const hasDiscoveryQuestion = /(which tool would you use|what tool would you use|tell me which tool|tell me what tool|which skill would you use|what skill would you use)/.test(normalized);
  const hasDiscoveryTopic = /(tool|skill|mailbox|email|calendar|meeting|github|repo|issue|weather|search)/.test(normalized);
  return hasReadOnlyConstraint && (hasDiscoveryQuestion || hasDiscoveryTopic);
}

export function buildReadOnlyDiscoveryQuery(userMessage: string): string {
  const stripped = stripValidationNoise(stripInjectedRoutingContext(userMessage));
  const cleaned = collapseWhitespace(
    stripped
      .replace(/\buse\s+(?:read[- ]only|discovery[- ]only|discovery only)\b/ig, '')
      .replace(/\bstay\s+in\s+(?:read[- ]only|discovery[- ]only|discovery only)\b/ig, '')
      .replace(/\bkeep\s+to\s+(?:read[- ]only|discovery[- ]only|discovery only)\b/ig, '')
      .replace(/\b(?:just\s+)?tell me which tool you would use to\b/ig, '')
      .replace(/\b(?:just\s+)?tell me what tool you would use to\b/ig, '')
      .replace(/\bwhich tool would you use to\b/ig, '')
      .replace(/\bwhat tool would you use to\b/ig, '')
      .replace(/\bwhich skill would you use to\b/ig, '')
      .replace(/\bwhat skill would you use to\b/ig, '')
      .replace(/\bdo not execute(?: any)? non-discovery tools\b/ig, '')
      .replace(/\bdon't execute(?: any)? non-discovery tools\b/ig, '')
      .replace(/\bwithout executing(?: any)? tools\b/ig, '')
      .replace(/\bfor issue\s+\d+\s+(?:primary|secondary)\b/ig, '')
      .replace(/[.]/g, ' '),
  ).replace(/^(?:and|then)\s+/i, '');

  return cleaned.length > 0 ? cleaned : collapseWhitespace(stripped);
}

function capitalizePhrase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildRelativeDayDate(keyword: 'today' | 'tomorrow'): Date {
  const date = new Date();
  date.setUTCSeconds(0, 0);
  if (keyword === 'tomorrow') {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

function parseCalendarTime(hourText: string, minuteText: string | undefined, meridiem: string | undefined): { hour: number; minute: number } | null {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? '0');

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem) {
    const normalized = meridiem.toLowerCase();
    if (hour < 1 || hour > 12) {
      return null;
    }
    if (normalized === 'pm' && hour !== 12) {
      hour += 12;
    }
    if (normalized === 'am' && hour === 12) {
      hour = 0;
    }
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute };
}

function parseDeterministicCalendarEventIntent(userMessage: string): DeterministicFollowUpToolCall | null {
  const normalizedMessage = stripValidationNoise(userMessage);
  const normalizedLower = normalizedMessage.toLowerCase();

  const looksLikeCalendarIntent = /(calendar|meeting|appointment|event)/.test(normalizedLower)
    && /(create|add|schedule|book|set up|put)/.test(normalizedLower);

  if (!looksLikeCalendarIntent) {
    return null;
  }

  const dayMatch = normalizedLower.match(/\b(today|tomorrow)\b/);
  const timeMatch = normalizedMessage.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);

  if (!dayMatch || !timeMatch) {
    return null;
  }

  const parsedTime = parseCalendarTime(timeMatch[1] ?? '', timeMatch[2], timeMatch[3]);
  if (!parsedTime) {
    return null;
  }

  const subjectMatch = normalizedMessage.match(
    /\b(?:calendar|meeting|appointment|event)\b.*?\b(?:to|for)\s+(.+?)\s+(?:today|tomorrow|at\s+\d)/i,
  );
  const rawSubject = subjectMatch?.[1]?.trim() ?? 'new calendar event';
  const cleanedSubject = rawSubject.replace(/^have\s+/i, '').trim();
  const subject = capitalizePhrase(cleanedSubject || 'new calendar event');

  const start = buildRelativeDayDate(dayMatch[1] === 'tomorrow' ? 'tomorrow' : 'today');
  start.setUTCHours(parsedTime.hour, parsedTime.minute, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const reminderMatch = normalizedLower.match(/\breminder\s+(\d+)\s*(?:minutes?|mins?|min)\s+before\b/i);
  const reminderMinutesBeforeStart = reminderMatch ? Number(reminderMatch[1]) : undefined;

  return {
    name: 'outlook_create_calendar_event',
    arguments: {
      subject,
      start: start.toISOString(),
      end: end.toISOString(),
      ...(reminderMinutesBeforeStart !== undefined
        ? {
            reminderMinutesBeforeStart,
            isReminderOn: true,
          }
        : {}),
    },
  };
}

function parseQuotedSendEmailIntent(userMessage: string): DeterministicFollowUpToolCall | null {
  const cleanedMessage = stripValidationNoise(userMessage);
  const match = cleanedMessage.match(
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

function buildDefaultInlineEmailBody(contentId: string): string {
  return `<p>Here is the inline image you requested.</p><img src="cid:${contentId}" />`;
}

function normalizeInlineContentIdCandidate(rawValue: string | undefined): string | undefined {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed
    .replace(/^cid:/i, '')
    .replace(/^<+/, '')
    .replace(/>+$/, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function selectInlineRuntimeAsset(
  runtimeAssets: RuntimeAssetReference[],
  userMessage: string,
): RuntimeAssetReference | undefined {
  const imageAssets = runtimeAssets.filter((asset) => asset.contentType.toLowerCase().startsWith('image/'));
  if (imageAssets.length === 0) {
    return undefined;
  }

  const fileNameMatch = userMessage.match(/`([^`]+\.(?:png|jpe?g|gif|webp|bmp|svg))`|\b([a-z0-9._-]+\.(?:png|jpe?g|gif|webp|bmp|svg))\b/i);
  const requestedFileName = (fileNameMatch?.[1] ?? fileNameMatch?.[2])?.toLowerCase();
  if (requestedFileName) {
    const exactMatch = imageAssets.find((asset) => asset.fileName?.toLowerCase() === requestedFileName);
    if (exactMatch) {
      return exactMatch;
    }
  }

  return imageAssets[0];
}

export function synthesizeRuntimeAssetInlineEmailToolCall(
  userMessage: string,
  runtimeAssets: RuntimeAssetReference[] | null | undefined,
): DeterministicFollowUpToolCall | null {
  if (!runtimeAssets || runtimeAssets.length === 0) {
    return null;
  }

  const cleanedMessage = stripValidationNoise(userMessage);
  const normalizedMessage = cleanedMessage.toLowerCase();
  const looksLikeInlineEmailRequest = /(send|email|mail)/.test(normalizedMessage)
    && /(inline|embedded|embed|cid:|image below|gif below|photo below|picture below|image in the body)/.test(normalizedMessage);

  if (!looksLikeInlineEmailRequest) {
    return null;
  }

  const selectedAsset = selectInlineRuntimeAsset(runtimeAssets, cleanedMessage);
  if (!selectedAsset) {
    return null;
  }

  const to = extractEmailAddresses(cleanedMessage);
  if (to.length === 0) {
    return null;
  }

  const subjectMatch = cleanedMessage.match(/\bsubject\s+["“'`](.+?)["”'`]/i);
  const subject = subjectMatch?.[1]?.trim() || 'Inline image from HelkinSwarm';

  const explicitCid = normalizeInlineContentIdCandidate(
    cleanedMessage.match(/cid:([^"'`\s>]+)/i)?.[1]
      ?? cleanedMessage.match(/contentid\s+[`"“'']?([^`"”'\s]+)[`"”'']?/i)?.[1],
  );
  const derivedCid = normalizeInlineContentIdCandidate(selectedAsset.fileName?.replace(/\.[^.]+$/, ''));
  const contentId = explicitCid || derivedCid || 'inline-image-1';

  return {
    name: 'outlook_send_email',
    arguments: {
      to,
      subject,
      body: buildDefaultInlineEmailBody(contentId),
      bodyType: 'html',
      inlineAssets: [
        {
          assetId: selectedAsset.id,
          contentId,
          ...(selectedAsset.fileName ? { fileName: selectedAsset.fileName } : {}),
        },
      ],
    },
  };
}

function parseMailboxFolderMention(normalizedMessage: string): string | undefined {
  const folderMatch = normalizedMessage.match(/\b(inbox|sentitems|drafts|archive)\b/i);
  return folderMatch?.[1]?.toLowerCase();
}

function parseMailboxTopCount(normalizedMessage: string): number | undefined {
  const topMatch = normalizedMessage.match(/\btop\s+(\d{1,2})\b/i);
  if (topMatch?.[1]) {
    return Number(topMatch[1]);
  }

  const recentCountMatch = normalizedMessage.match(/\b(?:most\s+recent|latest|newest|recent)\s+(\d{1,2})\s+(?:emails?|messages?)\b/i)
    ?? normalizedMessage.match(/\b(\d{1,2})\s+(?:most\s+recent|latest|newest|recent)\s+(?:emails?|messages?)\b/i)
    ?? normalizedMessage.match(/\b(\d{1,2})\s+(?:emails?|messages?)\b/i);
  if (recentCountMatch?.[1]) {
    return Number(recentCountMatch[1]);
  }

  if (/\b(latest|most recent|newest)\b/i.test(normalizedMessage)) {
    return 1;
  }

  return undefined;
}

function parseDeterministicOutlookListIntent(userMessage: string): DeterministicFollowUpToolCall | null {
  const cleanedMessage = stripValidationNoise(userMessage);
  const normalizedMessage = cleanedMessage.toLowerCase();

  const mentionsMailbox = /(outlook|mailbox|email|emails|message|messages|mail)\b/.test(normalizedMessage);
  const looksLikeListIntent = /\b(list|show|display)\b/.test(normalizedMessage)
    || /\b(most\s+recent|latest|newest|recent|unread)\b/.test(normalizedMessage);

  if (!mentionsMailbox || !looksLikeListIntent) {
    return null;
  }

  if (/(send|compose|draft|reply|respond)\b/.test(normalizedMessage)) {
    return null;
  }

  if (/(search|find|lookup|look up)\b/.test(normalizedMessage)) {
    return null;
  }

  if ((/\b(read|open)\b/.test(normalizedMessage) && /\b(email|message)\b/.test(normalizedMessage)) || /\bmessageid\b/.test(normalizedMessage)) {
    return null;
  }

  const folder = parseMailboxFolderMention(cleanedMessage);
  const top = parseMailboxTopCount(cleanedMessage) ?? 10;
  const filter = /\bunread\b/.test(normalizedMessage) ? 'isRead eq false' : undefined;

  return {
    name: 'outlook_list_emails',
    arguments: {
      top,
      ...(folder ? { folder } : {}),
      ...(filter ? { filter } : {}),
    },
  };
}

function parseDeterministicOutlookSearchIntent(userMessage: string): DeterministicFollowUpToolCall | null {
  const cleanedMessage = stripValidationNoise(userMessage);
  const normalizedMessage = cleanedMessage.toLowerCase();

  const looksLikeMailboxSearch = /(search|find|lookup|look up)/.test(normalizedMessage)
    && /(outlook|mailbox|email|emails|message|messages|mail)/.test(normalizedMessage);

  if (!looksLikeMailboxSearch) {
    return null;
  }

  const queryTerms: string[] = [];
  if (/\b(with|has)\s+attachments?\b/.test(normalizedMessage) || /\bhasattachment:true\b/.test(normalizedMessage)) {
    queryTerms.push('hasAttachment:true');
  }

  const fromMatch = cleanedMessage.match(/\bfrom\s+([^\s,]+@[^\s,]+)/i);
  if (fromMatch?.[1]) {
    queryTerms.push(`from:${fromMatch[1]}`);
  }

  const subjectQuotedMatch = cleanedMessage.match(/\bsubject\s+["“'`](.+?)["”'`]/i);
  if (subjectQuotedMatch?.[1]) {
    queryTerms.push(`subject:${subjectQuotedMatch[1]}`);
  }

  if (queryTerms.length === 0) {
    return null;
  }

  const folder = parseMailboxFolderMention(cleanedMessage);
  const top = parseMailboxTopCount(cleanedMessage);

  return {
    name: 'outlook_search_emails',
    arguments: {
      query: queryTerms.join(' '),
      ...(folder ? { folder } : {}),
      ...(top ? { top } : {}),
    },
  };
}

export function getDiscoveryFirstToolSchemas(): ToolDefinition[] {
  return toolRegistry
    .toFunctionSchemas()
    .filter((tool) => isCoreTool(tool.function.name));
}

export function deriveContextAwareInitialToolSchemas(
  userMessage: string,
  allToolSchemas: ToolDefinition[],
): ToolDefinition[] {
  const coreOnlySchemas = allToolSchemas.filter((tool) => isCoreTool(tool.function.name));
  if (!isExecutionProofPrompt(userMessage)) {
    return coreOnlySchemas;
  }

  const allToolNames = new Set(allToolSchemas.map((tool) => tool.function.name));
  const expandedNames = new Set(coreOnlySchemas.map((tool) => tool.function.name));
  const explicitToolName = findExplicitToolNameMention(userMessage.toLowerCase(), allToolNames);

  if (explicitToolName && !isCoreTool(explicitToolName)) {
    expandedNames.add(explicitToolName);
  }

  if (/(outlook|mailbox|email|attachments?)/i.test(userMessage) && allToolNames.has('outlook_search_emails')) {
    expandedNames.add('outlook_search_emails');
  }

  if (/(graphenterprise|microsoft graph enterprise mcp)/i.test(userMessage) && allToolNames.has('graphenterprise_list_properties')) {
    expandedNames.add('graphenterprise_list_properties');
  }

  return allToolSchemas.filter((tool) => expandedNames.has(tool.function.name));
}

export function getDiscoveryFirstToolDefinitions(): Array<{ name: string; description: string }> {
  return toolRegistry
    .getSafetyFiltered()
    .filter((tool) => isCoreTool(tool.name))
    .map((tool) => ({ name: tool.name, description: tool.description }));
}

export function shouldForceDiscoveryToolSearch(userMessage: string): boolean {
  if (parseExactReplyInstruction(userMessage)) {
    return false;
  }

  if (isReadOnlyDiscoveryRequest(userMessage)) {
    return true;
  }

  const normalized = userMessage.toLowerCase();
  const mentionsToolName = /\b[a-z]+_[a-z0-9_]+\b/.test(normalized);
  const mentionsAttachmentIntent = /(attachment|inline image|content id|cid|messageid)/.test(normalized);
  const hasExternalActionIntent = hasOutlookSendIntent(normalized)
    || hasOutlookReplyIntent(normalized)
    || /(calendar|meeting|schedule|github|repo|issue|pull request|weather|web search|search the web)/.test(normalized);

  return mentionsToolName
    || mentionsAttachmentIntent
    || hasExternalActionIntent;
}

export function getForcedInitialToolChoice(
  userMessage: string,
  tools: ToolDefinition[] | null | undefined,
): { type: 'function'; function: { name: string } } | null {
  if (!tools || tools.length === 0) return null;

  const normalized = userMessage.toLowerCase();
  const toolNames = new Set(tools.map((tool) => tool.function.name));

  if (isReadOnlyDiscoveryRequest(userMessage)) {
    return toolNames.has('helkin_skill_search')
      ? { type: 'function', function: { name: 'helkin_skill_search' } }
      : null;
  }

  const explicitToolName = findExplicitToolNameMention(normalized, toolNames);
  if (explicitToolName) {
    return { type: 'function', function: { name: explicitToolName } };
  }

  return shouldForceDiscoveryToolSearch(userMessage) && toolNames.has('helkin_skill_search')
    ? { type: 'function', function: { name: 'helkin_skill_search' } }
    : null;
}

export function getForcedDiscoveryFollowUpToolChoice(
  userMessage: string,
  tools: ToolDefinition[] | null | undefined,
): { type: 'function'; function: { name: string } } | null {
  if (!tools || tools.length === 0) return null;

  if (parseExactReplyInstruction(userMessage)) {
    return null;
  }

  const normalized = userMessage.toLowerCase();
  const toolNames = new Set(tools.map((tool) => tool.function.name));

  if (isReadOnlyDiscoveryRequest(userMessage)) {
    return toolNames.has('helkin_skill_search')
      ? { type: 'function', function: { name: 'helkin_skill_search' } }
      : null;
  }

  const explicitToolName = findExplicitToolNameMention(normalized, toolNames);
  if (explicitToolName) {
    return { type: 'function', function: { name: explicitToolName } };
  }

  if (/(search|find|lookup|look up)/.test(normalized) && toolNames.has('outlook_search_emails')) {
    return { type: 'function', function: { name: 'outlook_search_emails' } };
  }

  if (parseDeterministicOutlookListIntent(userMessage)) {
    if (toolNames.has('outlook_list_emails')) {
      return { type: 'function', function: { name: 'outlook_list_emails' } };
    }

    if (toolNames.has('outlook_search_emails')) {
      return { type: 'function', function: { name: 'outlook_search_emails' } };
    }
  }

  if (/(read|open|show).*(email|message|mail)/.test(normalized) && toolNames.has('outlook_read_email')) {
    return { type: 'function', function: { name: 'outlook_read_email' } };
  }

  if (/(attachment|inline image|content id|cid)/.test(normalized) && toolNames.has('outlook_list_attachments')) {
    return { type: 'function', function: { name: 'outlook_list_attachments' } };
  }

  if (/(download|save|materialize|retrieve).*(attachment|inline image|file)/.test(normalized) && toolNames.has('outlook_download_attachment')) {
    return { type: 'function', function: { name: 'outlook_download_attachment' } };
  }

  if (hasOutlookSendIntent(normalized) && toolNames.has('outlook_send_email')) {
    return { type: 'function', function: { name: 'outlook_send_email' } };
  }

  if (hasOutlookReplyIntent(normalized) && toolNames.has('outlook_reply_to_latest_email')) {
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

  if (toolNames.has('outlook_search_emails')) {
    const mailboxSearchIntent = parseDeterministicOutlookSearchIntent(userMessage);
    if (mailboxSearchIntent) {
      return mailboxSearchIntent;
    }
  }

  if (toolNames.has('outlook_list_emails')) {
    const mailboxListIntent = parseDeterministicOutlookListIntent(userMessage);
    if (mailboxListIntent) {
      return mailboxListIntent;
    }
  }

  if (toolNames.has('outlook_create_calendar_event')) {
    const calendarIntent = parseDeterministicCalendarEventIntent(userMessage);
    if (calendarIntent) {
      return calendarIntent;
    }
  }

  if (toolNames.has('outlook_send_email')) {
    const sendEmailIntent = parseQuotedSendEmailIntent(userMessage);
    if (sendEmailIntent) {
      return sendEmailIntent;
    }
  }

  return parseDeterministicSkillVerificationIntent(userMessage, toolNames);
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
  let suppressedNonChatRecoverableSkill = false;

  for (const tool of discoveryResult.result.tools ?? []) {
    const skill = tool.domain ? getDiscoverySkill(tool.domain) : undefined;
    if (tool.name && !isNonChatRecoverableSkillState(skill?.operationalState)) {
      selectedNames.add(tool.name);
    } else if (tool.name && isNonChatRecoverableSkillState(skill?.operationalState)) {
      suppressedNonChatRecoverableSkill = true;
    }
  }
  for (const group of discoveryResult.result.capabilityGroups ?? []) {
    const groupDomain = group.id?.split('/')[0];
    const skill = groupDomain ? getDiscoverySkill(groupDomain) : undefined;
    if (isNonChatRecoverableSkillState(skill?.operationalState)) {
      suppressedNonChatRecoverableSkill = true;
      continue;
    }

    for (const toolName of group.toolNames ?? []) {
      selectedNames.add(toolName);
    }
    if (group.id) {
      const manifestGroup = getDiscoveryCapabilityGroup(group.id);
      for (const toolName of manifestGroup?.toolNames ?? []) {
        selectedNames.add(toolName);
      }
    }
  }
  for (const skill of discoveryResult.result.skills ?? []) {
    if (isNonChatRecoverableSkillState(skill.operationalState)) {
      suppressedNonChatRecoverableSkill = true;
      continue;
    }

    for (const toolName of skill.recommendedEntryTools ?? []) {
      selectedNames.add(toolName);
    }
  }

  if (selectedNames.size === 0) {
    return suppressedNonChatRecoverableSkill
      ? toolRegistry.toFunctionSchemas().filter((tool) => isCoreTool(tool.function.name))
      : null;
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
    return 'I found the relevant calendar capability, but I did not reach a runnable calendar action yet, so I have not created an event. Please restate the request with the event subject plus the date and time, and include any attendees or reminder details you want.';
  }

  return 'I found a likely matching capability, but I did not reach a runnable tool yet, so I have not changed anything. Please restate the request with the exact action and the key details you want me to use.';
}

export function buildReadOnlyDiscoveryResponse(
  toolResults: ToolResult[] | null | undefined,
  userMessage: string,
): string {
  const discoveryResult = toolResults?.find((result) =>
    result.success && result.toolName === 'helkin_skill_search' && isReadOnlyDiscoverySearchResult(result.result),
  );

  const query = buildReadOnlyDiscoveryQuery(userMessage);
  const result = isReadOnlyDiscoverySearchResult(discoveryResult?.result)
    ? discoveryResult.result
    : undefined;
  const topTool = result?.tools?.[0];
  const topGroup = result?.capabilityGroups?.[0];
  const topSkill = result?.skills?.[0];
  const alternateTools = (result?.tools ?? [])
    .slice(1, 4)
    .map((tool: NonNullable<ReadOnlyDiscoverySearchResultShape['tools']>[number]) => tool.name)
    .filter((name: string | undefined): name is string => typeof name === 'string' && name.length > 0);

  if (!topTool && !topGroup && !topSkill) {
    return `I checked the installed skills without executing anything and searched for \`${query}\`, but I did not find a strong matching skill or tool. Try a broader request or use \`/skillSearch ${query}\` for a direct read-only lookup.`;
  }

  const parts = ['I checked the installed skills without executing anything yet.'];

  if (topGroup?.id) {
    const domain = topGroup.domain ? ` (${topGroup.domain})` : '';
    const description = topGroup.shortDescription ? ` — ${topGroup.shortDescription}` : '';
    const readinessState = topGroup.operationalState
      ?? (topGroup.domain ? getDiscoverySkill(topGroup.domain)?.operationalState : undefined);
    const readiness = readinessState ? ` — status: ${readinessState}` : '';
    parts.push(`Best matching capability group: \`${topGroup.id}\`${domain}${description}${readiness}.`);
  }

  if (topTool?.name) {
    const domain = topTool.domain ? ` (${topTool.domain}${topTool.risk ? `, risk: ${topTool.risk}` : ''})` : '';
    const description = topTool.description ? ` — ${topTool.description}` : '';
    const readinessState = topTool.skillOperationalState
      ?? (topTool.domain ? getDiscoverySkill(topTool.domain)?.operationalState : undefined);
    const readiness = readinessState ? ` — skill status: ${readinessState}` : '';
    parts.push(`Best matching tool: \`${topTool.name}\`${domain}${description}${readiness}.`);
  }

  if (topSkill?.domain) {
    const displayName = topSkill.displayName ? `${topSkill.displayName} ` : '';
    const description = topSkill.shortDescription ? ` — ${topSkill.shortDescription}` : '';
    const readinessState = topSkill.operationalState
      ?? getDiscoverySkill(topSkill.domain)?.operationalState;
    const readiness = readinessState ? ` — status: ${readinessState}` : '';
    parts.push(`Best matching skill: ${displayName}\`${topSkill.domain}\`${description}${readiness}.`);
  }

  if (alternateTools.length > 0) {
    parts.push(`Other likely matches: ${alternateTools.map((toolName: string) => `\`${toolName}\``).join(', ')}.`);
  }

  parts.push('I have not run the underlying skill yet.');
  return parts.join(' ');
}

function isDiscoverySearchResult(value: unknown): value is DiscoverySearchResultShape {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['tools']) || Array.isArray(candidate['skills']) || Array.isArray(candidate['capabilityGroups']);
}

function isReadOnlyDiscoverySearchResult(value: unknown): value is ReadOnlyDiscoverySearchResultShape {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate['command'] === 'search' && (Array.isArray(candidate['tools']) || Array.isArray(candidate['skills']) || Array.isArray(candidate['capabilityGroups']));
}

export function getDiscoveryFollowUpModelOverride(
  toolResults: ToolResult[],
): DiscoveryModelOverride | undefined {
  const discoveryResult = toolResults.find((result) =>
    result.success && result.toolName === 'helkin_skill_search' && isDiscoverySearchResult(result.result),
  );

  if (!discoveryResult || !discoveryResult.result || !isDiscoverySearchResult(discoveryResult.result)) {
    return undefined;
  }

  const matchedOverrides = new Set<DiscoveryModelOverride>();

  for (const skill of discoveryResult.result.skills ?? []) {
    if (!skill.domain) {
      continue;
    }

    const manifestSkill = getDiscoverySkill(skill.domain);
    const override = mapModelAffinityToOverride(manifestSkill?.modelAffinity);
    if (override) {
      matchedOverrides.add(override);
    }
  }

  return matchedOverrides.size === 1
    ? Array.from(matchedOverrides)[0]
    : undefined;
}

function mapModelAffinityToOverride(
  modelAffinity: ModelAffinity | undefined,
): DiscoveryModelOverride | undefined {
  const requestedSlot = modelAffinity?.execution ?? modelAffinity?.synthesis ?? modelAffinity?.discovery;

  if (requestedSlot === 'fast') {
    return 'secondary';
  }

  if (requestedSlot === 'primary' || requestedSlot === 'reasoning') {
    return 'primary';
  }

  return undefined;
}