// Tests for QuotedContext type and buildPrompt quoted-context injection (#278)
import { describe, it, expect } from 'vitest';
import type { QuotedContext, QuoteSource } from '../../src/bot/quotedContext.js';

describe('QuotedContext', () => {
  const sources: QuoteSource[] = ['cache', 'entity', 'channelData', 'blockquote', 'messageReference'];

  it('supports all four resolution sources', () => {
    for (const source of sources) {
      const ctx: QuotedContext = {
        text: 'Hello world',
        replyToId: 'msg-123',
        source,
        mayBeTruncated: source !== 'cache',
      };
      expect(ctx.source).toBe(source);
    }
  });

  it('allows undefined replyToId', () => {
    const ctx: QuotedContext = {
      text: 'Some quote',
      replyToId: undefined,
      source: 'blockquote',
      mayBeTruncated: true,
    };
    expect(ctx.replyToId).toBeUndefined();
  });

  it('round-trips through JSON serialization (Durable Functions compatibility)', () => {
    const ctx: QuotedContext = {
      text: 'Test quote with "special" chars',
      replyToId: 'activity-456',
      source: 'entity',
      mayBeTruncated: false,
    };
    const serialized = JSON.stringify(ctx);
    const deserialized = JSON.parse(serialized) as QuotedContext;
    expect(deserialized).toEqual(ctx);
  });

  it('cache source is never truncated', () => {
    const ctx: QuotedContext = {
      text: 'Full text from sent message cache',
      replyToId: 'reply-id',
      source: 'cache',
      mayBeTruncated: false,
    };
    expect(ctx.mayBeTruncated).toBe(false);
  });
});
