// Canonical chatroom_send wire-contract parser (#673).
// Both swarmLeaderActivity and swarmWorkerActivity intercept `chatroom_send`
// tool calls and must honor the canonical JSON envelope from docs/0zh §3.2.
// This helper parses + validates the `message` string, returning a typed
// payload on success and a best-effort fallback on parse failure so the
// transport never drops the message.

import { CanonicalChatroomPayloadSchema } from './swarmTypes.js';
import type { CanonicalChatroomPayload, ChatroomMessage } from './swarmTypes.js';

export interface ParsedChatroomSend {
  /** Human-readable body used as the ChatroomMessage.content. */
  displayContent: string;
  /** Parsed canonical envelope, or undefined if the message was legacy freeform. */
  payload?: CanonicalChatroomPayload;
  /** True when parsing failed or fields were missing; the sender emitted freeform text. */
  legacy: boolean;
}

/**
 * Parse the `message` argument from a chatroom_send tool call.
 *
 * Behavior:
 * - If the string is valid JSON matching the canonical envelope, return the
 *   parsed payload and use `payload.content` as displayContent.
 * - Otherwise, fall back to treating the whole string as legacy freeform content.
 *   This is non-fatal: older agents, first-turn prompts, and malformed outputs
 *   still get delivered so live sessions degrade gracefully.
 *
 * The `expectedSender` argument lets the caller warn when the agent's self-
 * declared sender drifts from its actual identity (logged by the caller).
 */
export function parseChatroomSendMessage(
  raw: string,
  _expectedSender: string,
): ParsedChatroomSend {
  if (!raw) return { displayContent: '', legacy: true };
  const trimmed = raw.trim();
  // Canonical envelope is always an object literal — skip the JSON parse for
  // anything that obviously isn't one. This avoids false JSON hits on quoted
  // strings or arrays the model might have emitted.
  if (!trimmed.startsWith('{')) {
    return { displayContent: raw, legacy: true };
  }
  try {
    const parsed = JSON.parse(trimmed);
    const validated = CanonicalChatroomPayloadSchema.safeParse(parsed);
    if (validated.success) {
      return {
        displayContent: validated.data.content,
        payload: validated.data,
        legacy: false,
      };
    }
    // JSON but wrong shape — keep the raw string as display so nothing is lost.
    return { displayContent: raw, legacy: true };
  } catch {
    return { displayContent: raw, legacy: true };
  }
}

/**
 * Echo guard: a sender must never receive its own message back into its context (#673).
 * Returns true when the recipient list includes the sender's identity.
 */
export function isSelfEcho(from: string, to: ChatroomMessage['to']): boolean {
  const recipients = Array.isArray(to) ? to : [to];
  return recipients.some(r => r.toLowerCase() === from.toLowerCase());
}

/**
 * Filter a recipient list so the sender is never addressed. "All" is preserved
 * because the downstream router converts it into a broadcast over registered
 * agents, which already excludes the sender.
 */
export function stripSelfEchoRecipients(
  from: string,
  to: ChatroomMessage['to'],
): ChatroomMessage['to'] {
  const recipients = Array.isArray(to) ? to : [to];
  const filtered = recipients.filter(r => r.toLowerCase() !== from.toLowerCase());
  if (filtered.length === 0) {
    // Agent tried to message only itself — route to the leader instead so the
    // message is still visible in the transcript.
    return 'Helkin';
  }
  return Array.isArray(to) ? filtered : filtered[0] ?? 'Helkin';
}
