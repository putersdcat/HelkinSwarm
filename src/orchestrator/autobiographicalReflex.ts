export interface RecentConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function resolveTimeZone(timezone: string | undefined): string {
  if (!timezone) {
    return 'UTC';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date('2026-04-09T00:00:00.000Z'));
    return timezone;
  } catch {
    return 'UTC';
  }
}

function formatDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(now);
}

function formatTime(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(now);
}

function getRecentUserRequests(recentHistory: RecentConversationTurn[]): string[] {
  return recentHistory
    .filter((turn) => turn.role === 'user')
    .map((turn) => collapseWhitespace(turn.content))
    .filter((content) => content.length > 0);
}

function isLastTwoRequestsPrompt(normalized: string): boolean {
  return /(what were my last two requests|what were my last 2 requests|what were my previous two requests|what were my previous 2 requests)/.test(normalized);
}

function isLastRequestPrompt(normalized: string): boolean {
  return /(what was my last request|what were my last request|what was my previous request|what did i ask last|what was my last prompt)/.test(normalized);
}

function isDayOrDatePrompt(normalized: string): boolean {
  return /(what day is it|what day is it today|what date is it|what is today's date|what is the current date|today's date)/.test(normalized);
}

function isTimePrompt(normalized: string): boolean {
  return /(what time is it|current time|time is it now)/.test(normalized);
}

export function buildRecentRequestRecallResponse(
  userMessage: string,
  recentHistory: RecentConversationTurn[],
): string | null {
  const normalized = collapseWhitespace(userMessage).toLowerCase();
  const recentUserRequests = getRecentUserRequests(recentHistory);

  if (isLastTwoRequestsPrompt(normalized)) {
    const lastTwo = recentUserRequests.slice(-2);
    if (lastTwo.length === 0) {
      return 'I do not have any prior requests from this active session yet.';
    }

    if (lastTwo.length === 1) {
      return `Your last request was: "${lastTwo[0]}".`;
    }

    return `Your last two requests were: "${lastTwo[0]}" and "${lastTwo[1]}".`;
  }

  if (isLastRequestPrompt(normalized)) {
    const lastRequest = recentUserRequests.at(-1);
    return lastRequest
      ? `Your last request was: "${lastRequest}".`
      : 'I do not have a prior request from this active session yet.';
  }

  return null;
}

export function buildTemporalGroundingResponse(
  userMessage: string,
  now: Date,
  timezone?: string,
): string | null {
  const normalized = collapseWhitespace(userMessage).toLowerCase();
  const resolvedTimezone = resolveTimeZone(timezone);
  const formattedDate = formatDate(now, resolvedTimezone);
  const formattedTime = formatTime(now, resolvedTimezone);

  if (isDayOrDatePrompt(normalized)) {
    return `Today is ${formattedDate} (${resolvedTimezone}).`;
  }

  if (isTimePrompt(normalized)) {
    return `The current time is ${formattedTime} on ${formattedDate}.`;
  }

  return null;
}

export function buildAutobiographicalPromptFragment(
  recentHistory: RecentConversationTurn[],
  now: Date,
  timezone?: string,
): string {
  const resolvedTimezone = resolveTimeZone(timezone);
  const recentUserRequests = getRecentUserRequests(recentHistory);
  const priorUserRequests = recentUserRequests.slice(-2);
  const parts = [
    'Immediate autobiographical grounding:',
    `- Current runtime date: ${formatDate(now, resolvedTimezone)} (${resolvedTimezone})`,
    `- Current runtime time: ${formatTime(now, resolvedTimezone)}`,
  ];

  if (priorUserRequests.length > 0) {
    parts.push(`- Most recent prior user requests: ${priorUserRequests.map((request) => `"${request}"`).join('; ')}`);
  }

  return parts.join('\n');
}