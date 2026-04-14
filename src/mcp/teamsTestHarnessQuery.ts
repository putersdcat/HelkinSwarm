export interface HarnessMessageFrom {
  user?: { displayName?: string; id?: string };
  application?: { displayName?: string; id?: string };
}

export interface HarnessRawMessage {
  id: string;
  createdDateTime: string;
  from?: HarnessMessageFrom;
  body?: { content?: string; contentType?: string };
  attachments?: HarnessRawAttachment[];
}

export interface HarnessRawAttachment {
  id?: string;
  contentType?: string;
  content?: string;
  contentUrl?: string;
  thumbnailUrl?: string;
  name?: string;
}

export type HarnessSenderKind = 'human' | 'bot' | 'system';
export type HarnessMessageDirection = 'any' | 'human-to-bot' | 'bot-to-human' | 'human-only' | 'bot-only' | 'system';
export type HarnessPickMode = 'all' | 'first' | 'last';

export interface NormalizedHarnessMessage {
  id: string;
  createdDateTime: string;
  senderDisplayName: string;
  senderId?: string;
  senderKind: HarnessSenderKind;
  text: string;
  html: string;
  contentType: string;
  formatting: HarnessFormattingHints;
  attachments: NormalizedHarnessAttachment[];
  cards: NormalizedHarnessAttachment[];
  correlationMatches: string[];
}

export interface HarnessFormattingHints {
  hasHtml: boolean;
  hasMarkdownLike: boolean;
  hasCodeBlock: boolean;
  hasInlineCode: boolean;
}

export interface NormalizedHarnessAttachment {
  id?: string;
  name?: string;
  contentType: string;
  kind: 'adaptive-card' | 'signin-card' | 'image' | 'file' | 'message-reference' | 'other';
  contentUrl?: string;
  thumbnailUrl?: string;
  contentText?: string;
  cardPayload?: unknown;
}

export interface HarnessMessageQuery {
  direction?: HarnessMessageDirection;
  contains?: string;
  correlation?: string;
  messageId?: string;
  beforeMessageId?: string;
  afterMessageId?: string;
  sinceIso?: string;
  untilIso?: string;
  newestFirst?: boolean;
  limit?: number;
  pick?: HarnessPickMode;
}

export interface HarnessMessageWindowQuery {
  aroundMessageId?: string;
  aroundCorrelation?: string;
  aroundContains?: string;
  beforeCount?: number;
  afterCount?: number;
  direction?: HarnessMessageDirection;
}

export interface HarnessSessionBundleQuery {
  correlation?: string;
  aroundContains?: string;
  aroundMessageId?: string;
  beforeCount?: number;
  afterCount?: number;
  direction?: HarnessMessageDirection;
}

export interface HarnessSessionBundle {
  correlationTag: string | null;
  anchor: NormalizedHarnessMessage | null;
  messages: NormalizedHarnessMessage[];
  timing: {
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    elapsedMs: number;
  };
  participants: Array<{ name: string; kind: HarnessSenderKind; count: number }>;
  telemetryFooters: string[];
  toolHints: string[];
  confirmationDetected: boolean;
  cards: Array<{ messageId: string; kind: NormalizedHarnessAttachment['kind']; contentType: string; payload: unknown }>;
}

export interface HarnessSentMessageAnchor {
  id?: string;
  createdDateTime?: string;
}

export interface HarnessBotReplySearchOptions {
  botUserId?: string;
  botDisplayNameHint?: string;
}

const CORRELATION_PATTERNS = [
  /\[DL-[^\]]+\]/g,
  /\[corr:[^\]]+\]/gi,
  /\bcorr:[A-Za-z0-9-]+\b/g,
];

function stripHtml(value: string | undefined): string {
  return (value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function detectFormatting(text: string, html: string): HarnessFormattingHints {
  const hasHtml = /<[^>]+>/.test(html);
  const hasCodeBlock = /```/.test(text) || /<pre\b/i.test(html);
  const hasInlineCode = /`[^`]+`/.test(text) || /<code\b/i.test(html);
  const hasMarkdownLike = /(^|\s)([#>*-]|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/.test(text)
    || hasCodeBlock
    || hasInlineCode;

  return {
    hasHtml,
    hasMarkdownLike,
    hasCodeBlock,
    hasInlineCode,
  };
}

function parseAttachmentPayload(content: string | undefined): unknown {
  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function normalizeAttachment(attachment: HarnessRawAttachment): NormalizedHarnessAttachment {
  const contentType = attachment.contentType ?? 'unknown';
  const lowerType = contentType.toLowerCase();
  const parsedPayload = parseAttachmentPayload(attachment.content);
  const kind: NormalizedHarnessAttachment['kind'] = lowerType.includes('adaptive')
    ? 'adaptive-card'
    : lowerType.includes('signin')
      ? 'signin-card'
      : lowerType === 'messagereference'
        ? 'message-reference'
      : lowerType.startsWith('image/') || !!attachment.thumbnailUrl
        ? 'image'
        : lowerType.includes('file') || (!!attachment.contentUrl && !!attachment.name)
          ? 'file'
          : 'other';

  return {
    id: attachment.id,
    name: attachment.name,
    contentType,
    kind,
    contentUrl: attachment.contentUrl,
    thumbnailUrl: attachment.thumbnailUrl,
    contentText: typeof attachment.content === 'string' && !parsedPayload ? attachment.content : undefined,
    cardPayload: parsedPayload,
  };
}

function messageSearchHaystack(message: NormalizedHarnessMessage): string {
  const attachmentText = message.attachments
    .map((attachment) => {
      if (attachment.cardPayload) {
        return JSON.stringify(attachment.cardPayload);
      }
      return attachment.contentText ?? '';
    })
    .join(' ');

  return [message.text, message.html, attachmentText].join(' ').toLowerCase();
}

function collectTelemetryFooters(messages: NormalizedHarnessMessage[]): string[] {
  const matches = new Set<string>();
  for (const message of messages) {
    for (const match of message.text.matchAll(/\[[^\]]*(?:corr:|E2E:)[^\]]*\]/g)) {
      if (match[0]) {
        matches.add(match[0]);
      }
    }
  }
  return [...matches];
}

function collectToolHints(messages: NormalizedHarnessMessage[]): string[] {
  const hints = new Set<string>();
  for (const message of messages) {
    for (const match of message.text.matchAll(/\b[a-z]+(?:_[a-z0-9]+)+\b/gi)) {
      if (match[0]) {
        hints.add(match[0]);
      }
    }
  }
  return [...hints];
}

function collectCorrelationCandidates(messages: NormalizedHarnessMessage[]): string[] {
  const matches = new Set<string>();
  for (const message of messages) {
    for (const match of message.correlationMatches) {
      matches.add(match);
    }
  }
  return [...matches];
}

function collectCorrelationMatches(text: string): string[] {
  const matches = new Set<string>();
  for (const pattern of CORRELATION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match[0]) {
        matches.add(match[0]);
      }
    }
  }
  return [...matches];
}

export function normalizeHarnessMessage(message: HarnessRawMessage): NormalizedHarnessMessage {
  const senderKind: HarnessSenderKind = message.from?.application
    ? 'bot'
    : message.from?.user
      ? 'human'
      : 'system';
  const html = message.body?.content ?? '';
  const text = stripHtml(html);
  const senderDisplayName = message.from?.application?.displayName
    ?? message.from?.user?.displayName
    ?? 'unknown';
  const senderId = message.from?.application?.id ?? message.from?.user?.id;
  const attachments = (message.attachments ?? []).map(normalizeAttachment);

  return {
    id: message.id,
    createdDateTime: message.createdDateTime,
    senderDisplayName,
    senderId,
    senderKind,
    text,
    html,
    contentType: message.body?.contentType ?? 'text',
    formatting: detectFormatting(text, html),
    attachments,
    cards: attachments.filter((attachment) => attachment.kind === 'adaptive-card' || attachment.kind === 'signin-card'),
    correlationMatches: collectCorrelationMatches(text),
  };
}

function matchesDirection(message: NormalizedHarnessMessage, direction: HarnessMessageDirection | undefined): boolean {
  switch (direction ?? 'any') {
    case 'any':
      return true;
    case 'human-to-bot':
    case 'human-only':
      return message.senderKind === 'human';
    case 'bot-to-human':
    case 'bot-only':
      return message.senderKind === 'bot';
    case 'system':
      return message.senderKind === 'system';
  }
}

function applyPickMode(messages: NormalizedHarnessMessage[], pick: HarnessPickMode | undefined): NormalizedHarnessMessage[] {
  switch (pick ?? 'all') {
    case 'first':
      return messages.length > 0 ? [messages[0]] : [];
    case 'last':
      return messages.length > 0 ? [messages[messages.length - 1]] : [];
    case 'all':
      return messages;
  }
}

export function queryHarnessMessages(
  rawMessages: HarnessRawMessage[],
  query: HarnessMessageQuery = {},
): NormalizedHarnessMessage[] {
  const normalized = rawMessages
    .map(normalizeHarnessMessage)
    .sort((a, b) => new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime());

  const messageIdIndex = query.messageId
    ? normalized.findIndex((message) => message.id === query.messageId)
    : -1;
  const beforeIndex = query.beforeMessageId
    ? normalized.findIndex((message) => message.id === query.beforeMessageId)
    : -1;
  const afterIndex = query.afterMessageId
    ? normalized.findIndex((message) => message.id === query.afterMessageId)
    : -1;

  const contains = query.contains?.toLowerCase();
  const correlation = query.correlation?.toLowerCase();
  const sinceMs = query.sinceIso ? new Date(query.sinceIso).getTime() : Number.NEGATIVE_INFINITY;
  const untilMs = query.untilIso ? new Date(query.untilIso).getTime() : Number.POSITIVE_INFINITY;

  let filtered = normalized.filter((message, index) => {
    const timestamp = new Date(message.createdDateTime).getTime();
    if (timestamp < sinceMs || timestamp > untilMs) {
      return false;
    }
    if (!matchesDirection(message, query.direction)) {
      return false;
    }
    if (contains && !message.text.toLowerCase().includes(contains)) {
      if (!messageSearchHaystack(message).includes(contains)) {
        return false;
      }
    }
    if (correlation) {
      const matches = message.correlationMatches.some((match) => match.toLowerCase().includes(correlation))
        || messageSearchHaystack(message).includes(correlation);
      if (!matches) {
        return false;
      }
    }
    if (messageIdIndex >= 0 && index !== messageIdIndex) {
      return false;
    }
    if (beforeIndex >= 0 && index >= beforeIndex) {
      return false;
    }
    if (afterIndex >= 0 && index <= afterIndex) {
      return false;
    }
    return true;
  });

  filtered = applyPickMode(filtered, query.pick);

  if (query.newestFirst) {
    filtered = [...filtered].reverse();
  }

  const limit = query.limit && query.limit > 0 ? query.limit : filtered.length;
  return filtered.slice(0, limit);
}

export function getHarnessMessageWindow(
  rawMessages: HarnessRawMessage[],
  query: HarnessMessageWindowQuery,
): { anchor: NormalizedHarnessMessage | null; messages: NormalizedHarnessMessage[] } {
  const normalized = rawMessages
    .map(normalizeHarnessMessage)
    .sort((a, b) => new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime());

  const direction = query.direction ?? 'any';
  const anchor = normalized.find((message) => {
    if (!matchesDirection(message, direction)) {
      return false;
    }
    if (query.aroundMessageId && message.id === query.aroundMessageId) {
      return true;
    }
    if (query.aroundCorrelation) {
      const needle = query.aroundCorrelation.toLowerCase();
      return message.correlationMatches.some((match) => match.toLowerCase().includes(needle))
        || messageSearchHaystack(message).includes(needle);
    }
    if (query.aroundContains) {
      return messageSearchHaystack(message).includes(query.aroundContains.toLowerCase());
    }
    return false;
  }) ?? null;

  if (!anchor) {
    return { anchor: null, messages: [] };
  }

  const anchorIndex = normalized.findIndex((message) => message.id === anchor.id);
  const beforeCount = Math.max(query.beforeCount ?? 3, 0);
  const afterCount = Math.max(query.afterCount ?? 3, 0);

  const start = Math.max(anchorIndex - beforeCount, 0);
  const end = Math.min(anchorIndex + afterCount + 1, normalized.length);
  const window = normalized.slice(start, end).filter((message) => matchesDirection(message, direction));

  return { anchor, messages: window };
}

export function buildHarnessSessionBundle(
  rawMessages: HarnessRawMessage[],
  query: HarnessSessionBundleQuery = {},
): HarnessSessionBundle {
  const window = getHarnessMessageWindow(rawMessages, {
    aroundMessageId: query.aroundMessageId,
    aroundCorrelation: query.correlation,
    aroundContains: query.aroundContains,
    beforeCount: query.beforeCount ?? 3,
    afterCount: query.afterCount ?? 3,
    direction: query.direction,
  });

  const messages = window.messages;
  const firstMessageAt = messages[0]?.createdDateTime ?? null;
  const lastMessageAt = messages[messages.length - 1]?.createdDateTime ?? null;
  const elapsedMs = firstMessageAt && lastMessageAt
    ? new Date(lastMessageAt).getTime() - new Date(firstMessageAt).getTime()
    : 0;

  const participantsMap = new Map<string, { name: string; kind: HarnessSenderKind; count: number }>();
  for (const message of messages) {
    const key = `${message.senderKind}:${message.senderDisplayName}`;
    const current = participantsMap.get(key) ?? {
      name: message.senderDisplayName,
      kind: message.senderKind,
      count: 0,
    };
    current.count += 1;
    participantsMap.set(key, current);
  }

  const cards = messages.flatMap((message) =>
    message.cards.map((card) => ({
      messageId: message.id,
      kind: card.kind,
      contentType: card.contentType,
      payload: card.cardPayload ?? card.contentText ?? null,
    })),
  );

  const nearbyCorrelation = collectCorrelationCandidates(messages)[0] ?? null;
  const footerCorrelation = collectTelemetryFooters(messages).find((value) => value.toLowerCase().includes('corr:')) ?? null;

  const correlationTag = query.correlation
    ?? window.anchor?.correlationMatches[0]
    ?? nearbyCorrelation
    ?? footerCorrelation
    ?? null;

  return {
    correlationTag,
    anchor: window.anchor,
    messages,
    timing: {
      firstMessageAt,
      lastMessageAt,
      elapsedMs,
    },
    participants: [...participantsMap.values()],
    telemetryFooters: collectTelemetryFooters(messages),
    toolHints: collectToolHints(messages),
    confirmationDetected: cards.length > 0,
    cards,
  };
}

function matchesBotIdentity(
  message: HarnessRawMessage,
  options: HarnessBotReplySearchOptions = {},
): boolean {
  if (message.from?.application) {
    return true;
  }

  const expectedBotUserId = options.botUserId?.trim();
  if (expectedBotUserId && message.from?.user?.id === expectedBotUserId) {
    return true;
  }

  const displayNameHint = options.botDisplayNameHint?.trim().toLowerCase();
  const senderName = message.from?.user?.displayName?.toLowerCase() ?? '';
  return !!displayNameHint && senderName.includes(displayNameHint);
}

export function findFirstBotReplyAfterMessage(
  rawMessages: HarnessRawMessage[],
  sentAnchor: HarnessSentMessageAnchor,
  options: HarnessBotReplySearchOptions = {},
): HarnessRawMessage | null {
  const messages = [...rawMessages].sort(
    (a, b) => new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
  );

  if (sentAnchor.id) {
    const sentIndex = messages.findIndex((message) => message.id === sentAnchor.id);
    if (sentIndex >= 0) {
      for (let index = sentIndex + 1; index < messages.length; index += 1) {
        const candidate = messages[index];
        if (candidate && matchesBotIdentity(candidate, options)) {
          return candidate;
        }
      }
    }
  }

  const sentCreatedTime = sentAnchor.createdDateTime
    ? new Date(sentAnchor.createdDateTime).getTime()
    : Number.NaN;
  if (!Number.isFinite(sentCreatedTime)) {
    return null;
  }

  for (const candidate of messages) {
    if (!matchesBotIdentity(candidate, options)) {
      continue;
    }

    const candidateCreatedTime = new Date(candidate.createdDateTime).getTime();
    if (candidateCreatedTime >= sentCreatedTime) {
      return candidate;
    }
  }

  return null;
}