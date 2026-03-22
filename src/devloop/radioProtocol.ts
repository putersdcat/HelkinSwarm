// Radio Protocol parser — detects and parses DevLoop bidirectional messages.
// Spec ref: docs/0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md
// Fix: #147

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const DevLoopPrefixSchema = z.enum(['DEVLOOP', 'DEVQUERY', 'SWARM', 'HUMAN']);
export type DevLoopPrefix = z.infer<typeof DevLoopPrefixSchema>;

export interface DevLoopMessage {
  /** Whether the message matched any protocol prefix */
  isDevLoop: boolean;
  /** Detected prefix, or null for non-protocol messages */
  prefix: DevLoopPrefix | null;
  /** Extracted correlation tag, e.g. "[DL-20260322070000-A7F2]" */
  correlationTag: string | null;
  /** The message body with protocol markers removed (content-filter-safe) */
  body: string;
  /** Whether the message ended with OVER */
  hasOver: boolean;
  /** The original raw message, unmodified */
  raw: string;
}

// ---------------------------------------------------------------------------
// Serializable context (for Durable Functions event passing — #147)
// Enum types are lost in JSON serialization, so use plain strings.
// ---------------------------------------------------------------------------

export interface DevLoopContext {
  isDevLoop: boolean;
  prefix: string | null;
  correlationTag: string | null;
  body: string;
  hasOver: boolean;
}

export function toDevLoopContext(msg: DevLoopMessage): DevLoopContext | undefined {
  if (!msg.isDevLoop) return undefined;
  return {
    isDevLoop: msg.isDevLoop,
    prefix: msg.prefix,
    correlationTag: msg.correlationTag,
    body: msg.body,
    hasOver: msg.hasOver,
  };
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches protocol prefix at start of message: DEVLOOP: / DEVQUERY: / SWARM: / HUMAN: */
const PREFIX_RE = /^(DEVLOOP|DEVQUERY|SWARM|HUMAN):\s*/i;

/** Matches correlation tags: [DL-YYYYMMDDHHmmss-XXXX] or [probe-XXXX] */
const CORRELATION_TAG_RE = /\[(DL-[^\]]+|probe-[^\]]+)\]/gi;

/** Matches trailing OVER (with optional whitespace) */
const OVER_RE = /\s+OVER\s*$/i;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseDevLoopMessage(raw: string): DevLoopMessage {
  let text = raw;

  // 1. Detect and extract prefix
  const prefixMatch = text.match(PREFIX_RE);
  let prefix: DevLoopPrefix | null = null;
  if (prefixMatch) {
    prefix = prefixMatch[1].toUpperCase() as DevLoopPrefix;
    text = text.slice(prefixMatch[0].length);
  }

  // 2. Extract correlation tags
  let correlationTag: string | null = null;
  const tagMatch = text.match(CORRELATION_TAG_RE);
  if (tagMatch) {
    // Use the first tag found as the primary correlation tag
    correlationTag = tagMatch[0];
    // Remove all tags from the body text
    text = text.replace(CORRELATION_TAG_RE, '').trim();
  }

  // 3. Detect and strip trailing OVER
  const hasOver = OVER_RE.test(text);
  if (hasOver) {
    text = text.replace(OVER_RE, '');
  }

  // 4. Clean up residual whitespace
  const body = text.trim();

  return {
    isDevLoop: prefix !== null,
    prefix,
    correlationTag,
    body,
    hasOver,
    raw,
  };
}
