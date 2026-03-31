import { describe, expect, it } from 'vitest';
import { getSingleEmojiBypassReply } from '../../src/bot/emojiEasterEggs.js';

describe('single emoji easter egg detection', () => {
  it('returns the same emoji when the full trimmed message is one emoji grapheme', () => {
    expect(getSingleEmojiBypassReply('👋')).toBe('👋');
    expect(getSingleEmojiBypassReply(' 🙌 ')).toBe('🙌');
    expect(getSingleEmojiBypassReply('🤝')).toBe('🤝');
  });

  it('does not trigger for text, multiple emoji, or empty input', () => {
    expect(getSingleEmojiBypassReply('hello')).toBeUndefined();
    expect(getSingleEmojiBypassReply('👋👋')).toBeUndefined();
    expect(getSingleEmojiBypassReply('👋 hi')).toBeUndefined();
    expect(getSingleEmojiBypassReply('   ')).toBeUndefined();
  });
});