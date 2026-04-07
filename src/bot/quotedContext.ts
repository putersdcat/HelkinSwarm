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

/**
 * Removes embedded Teams quote HTML/XML from the raw activity text (#578).
 * Teams clients prepend the message you are replying to inside the new message's body 
 * (using blockquote, quote, or inline attachment tags). If we do not strip these out,
 * the previous bot reply poisons the new user prompt, defeating routing boundaries.
 */
export function stripInlineQuotesFromActivityText(text: string): string {
  if (!text) {
    return '';
  }

  let cleaned = text.trim();

  // Strip standard Teams HTML blockquote structures
  cleaned = cleaned.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
  
  // Strip raw <quote> tags occasionally found in alternative payloads
  cleaned = cleaned.replace(/<quote[^>]*>[\s\S]*?<\/quote>/gi, '');

  // Strip <attachment> placeholders that sometimes represent the inline quote
  cleaned = cleaned.replace(/<attachment[^>]*>[\s\S]*?<\/attachment>/gi, '');

  // Optionally strip HTML formatting artifacts left behind (e.g. empty paragraphs)
  // Teams sometimes leaves a <p> wrapper around the blockquote, so after removing it we get <p></p>.
  // But doing a general HTML strip here might interfere with user's intentional formatting. 
  // We'll trust the LLM to ignore empty tags, but wait: the orchestrator LLM usually strips text. 
  // We will leave the rest of the text structurally intact.
  
  return cleaned.trim();
}
