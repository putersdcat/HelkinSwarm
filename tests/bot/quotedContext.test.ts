// Tests for QuotedContext type and buildPrompt quoted-context injection (#278)
import { describe, it, expect } from 'vitest';
import {
  sanitizeQuotedReplyText,
  type QuotedContext,
  type QuoteSource,
} from '../../src/bot/quotedContext.js';

describe('QuotedContext', () => {
  const sources: QuoteSource[] = ['cache', 'store', 'entity', 'channelData', 'blockquote', 'messageReference'];

  it('supports all quoted-context resolution sources', () => {
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

  it('store source is never truncated', () => {
    const ctx: QuotedContext = {
      text: 'Full text from persisted sent-message storage',
      replyToId: 'reply-id',
      source: 'store',
      mayBeTruncated: false,
    };
    expect(ctx.mayBeTruncated).toBe(false);
  });
});


  it('strips telemetry footers from stored bot replies before they are reused as quoted context', () => {
    const sanitized = sanitizeQuotedReplyText(
      'I checked the installed skills without executing anything yet. Best matching tool: outlook_search_emails.\n\n[E2E:3062ms|m:gpt-5.4-mini-2026-03-17|pt:3068|ct:42|prompt:1751ms|llm:880ms|tools:103ms|tools:helkin_skill_search|safe:✓|tok:1|corr:fd7105b9]',
    );

    expect(sanitized).toBe(
      'I checked the installed skills without executing anything yet. Best matching tool: outlook_search_emails.',
    );
    expect(sanitized).not.toContain('helkin_skill_search');
    expect(sanitized).not.toContain('[E2E:');
  });

  it('preserves quoted replies that do not have telemetry footers', () => {
    expect(sanitizeQuotedReplyText('Best matching tool: outlook_search_emails')).toBe(
      'Best matching tool: outlook_search_emails',
    );
  });
