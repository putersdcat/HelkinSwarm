import { describe, expect, it } from 'vitest';
import { replyChunkingInternals, splitReplyIntoChunks } from '../../src/orchestrator/replyChunking.js';

describe('replyChunking', () => {
  it('returns a single chunk for short messages', () => {
    expect(splitReplyIntoChunks('hello')).toEqual([
      { text: 'hello', isMultipart: false, index: 0, total: 1 },
    ]);
  });

  it('splits long messages into multipart chunks under the reply limit', () => {
    const longText = Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}: ${'x'.repeat(80)}`).join('\n\n');
    const chunks = splitReplyIntoChunks(longText);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= replyChunkingInternals.MAX_REPLY_CHARS)).toBe(true);
    expect(chunks[0]?.text.startsWith('(part 1/')).toBe(true);
    expect(chunks.at(-1)?.text).toContain(`(part ${chunks.length}/${chunks.length})`);
  });

  it('falls back to hard splits when no natural break exists', () => {
    const chunks = splitReplyIntoChunks('x'.repeat(replyChunkingInternals.MAX_REPLY_CHARS * 2));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= replyChunkingInternals.MAX_REPLY_CHARS)).toBe(true);
  });
});