// Structured quoted-reply context from Teams reply-with-quote (#278).
// Used throughout the orchestration path instead of mutating the raw user message.

const TELEMETRY_FOOTER_PATTERN = /\n+\[E2E:[\s\S]*$/i;

/** Resolution source for the quoted text. */
export type QuoteSource = 'cache' | 'store' | 'entity' | 'channelData' | 'blockquote' | 'messageReference';

/** Structured representation of a Teams reply-with-quote payload. */
export interface QuotedContext {
  /** The quoted text content. */
  text: string;
  /** The activity ID of the message being replied to, if available. */
  replyToId: string | undefined;
  /** How the quote was resolved — determines confidence. */
  source: QuoteSource;
  /** True when the text may be truncated by Teams (not from full-text cache). */
  mayBeTruncated: boolean;
}

/**
 * Strip bot telemetry footers from quoted reply text before it is injected back
 * into routing/prompt context. Quoted continuity needs the semantic reply body,
 * not the debug footer metadata.
 */
export function sanitizeQuotedReplyText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const withoutFooter = trimmed.replace(TELEMETRY_FOOTER_PATTERN, '').trim();
  const collapsed = withoutFooter.replace(/\n{3,}/g, '\n\n').trim();
  return collapsed.length > 0 ? collapsed : trimmed;
}
