import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const CLARIFICATION_TTL_MS = 10 * 60_000;

const CALENDAR_ENTITY_HINT = /\b(calendar|meeting|event)\b/i;
const CALENDAR_ACTION_HINT = /\b(add|book|create|put|schedule)\b/i;
const CALENDAR_DATE_HINT = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const EXPLICIT_TIME_HINT = /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:am|pm)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\bnoon\b|\bmidnight\b/i;
const CANCEL_HINT = /^(?:cancel|forget it|never mind|nevermind|stop)$/i;

export const PendingClarificationSchema = z.object({
  id: z.string(),
  reason: z.enum(['missing_calendar_time']),
  questionText: z.string(),
  answerMode: z.enum(['text']),
  originalUserMessage: z.string(),
  requestedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  timeoutBehavior: z.enum(['expire_and_restart']),
  resumeHint: z.string(),
  modelOverride: z.string().optional(),
});

export type PendingClarification = z.infer<typeof PendingClarificationSchema>;

export interface ClarificationRequest {
  pending: PendingClarification;
  responseMessage: string;
}

export type ClarificationResolution =
  | { kind: 'resume'; resumedUserMessage: string }
  | { kind: 'retry'; responseMessage: string; pending: PendingClarification }
  | { kind: 'cancelled'; responseMessage: string }
  | { kind: 'expired'; responseMessage: string };

export function detectClarificationRequest(
  userMessage: string,
  now: Date,
  modelOverride?: string,
): ClarificationRequest | undefined {
  const trimmed = userMessage.trim();

  if (!looksLikeCalendarCreateMissingTime(trimmed)) {
    return undefined;
  }

  const requestedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CLARIFICATION_TTL_MS).toISOString();
  const pending = PendingClarificationSchema.parse({
    id: randomUUID(),
    reason: 'missing_calendar_time',
    questionText: 'What time should I put it on your calendar?',
    answerMode: 'text',
    originalUserMessage: trimmed,
    requestedAt,
    expiresAt,
    timeoutBehavior: 'expire_and_restart',
    resumeHint: 'Resume the original calendar-creation request using the supplied time. Do not ask for the same time again unless the answer is still unusable.',
    modelOverride,
  });

  return {
    pending,
    responseMessage: 'I can do that, but I need one detail first: **what time should I put it on your calendar?**\n\nReply with a specific time like `12:30 PM` or say `cancel`. This clarification expires in 10 minutes.',
  };
}

export function resolveClarificationAnswer(
  pending: PendingClarification,
  answerText: string,
  now: Date,
): ClarificationResolution {
  const trimmed = answerText.trim();

  if (now.getTime() > new Date(pending.expiresAt).getTime()) {
    return {
      kind: 'expired',
      responseMessage: '⏰ That clarification request expired before your answer arrived. Please resend the original request if you still want me to continue.',
    };
  }

  if (CANCEL_HINT.test(trimmed)) {
    return {
      kind: 'cancelled',
      responseMessage: '❌ Okay — I cancelled that clarification request. If you still want the task later, just send the original request again.',
    };
  }

  if (pending.reason === 'missing_calendar_time' && !hasExplicitTime(trimmed)) {
    return {
      kind: 'retry',
      pending,
      responseMessage: 'I’m still missing the time for that calendar event. Reply with a specific time like `12:30 PM` or say `cancel`.',
    };
  }

  return {
    kind: 'resume',
    resumedUserMessage: `${pending.originalUserMessage}\n\nClarification answer from the user: ${trimmed}\n\n${pending.resumeHint}`,
  };
}

function looksLikeCalendarCreateMissingTime(userMessage: string): boolean {
  return CALENDAR_ENTITY_HINT.test(userMessage)
    && CALENDAR_ACTION_HINT.test(userMessage)
    && CALENDAR_DATE_HINT.test(userMessage)
    && !hasExplicitTime(userMessage);
}

function hasExplicitTime(text: string): boolean {
  return EXPLICIT_TIME_HINT.test(text);
}