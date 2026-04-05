// Structured quoted-reply context from Teams reply-with-quote (#278).
// Used throughout the orchestration path instead of mutating the raw user message.

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
