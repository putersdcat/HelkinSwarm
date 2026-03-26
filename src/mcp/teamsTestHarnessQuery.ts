export interface HarnessMessageFrom {
  user?: { displayName?: string; id?: string };
  application?: { displayName?: string; id?: string };
}

export interface HarnessRawMessage {
  id: string;
  createdDateTime: string;
  from?: HarnessMessageFrom;
  body?: { content?: string; contentType?: string };
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
  correlationMatches: string[];
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

  return {
    id: message.id,
    createdDateTime: message.createdDateTime,
    senderDisplayName,
    senderId,
    senderKind,
    text,
    html,
    contentType: message.body?.contentType ?? 'text',
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
      return false;
    }
    if (correlation) {
      const matches = message.correlationMatches.some((match) => match.toLowerCase().includes(correlation))
        || message.text.toLowerCase().includes(correlation);
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
        || message.text.toLowerCase().includes(needle);
    }
    if (query.aroundContains) {
      return message.text.toLowerCase().includes(query.aroundContains.toLowerCase());
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