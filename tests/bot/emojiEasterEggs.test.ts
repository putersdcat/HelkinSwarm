import { describe, expect, it } from 'vitest';
import { getSingleEmojiBypassReply } from '../../src/bot/emojiEasterEggs.js';

describe('single emoji easter egg detection', () => {
  it('returns the same emoji when the full trimmed message is one emoji grapheme', () => {
    expect(getSingleEmojiBypassReply({ messageText: '👋' })).toEqual({ text: '👋' });
    expect(getSingleEmojiBypassReply({ messageText: ' 🙌 ' })).toEqual({ text: '🙌' });
    expect(getSingleEmojiBypassReply({ messageText: '🤝' })).toEqual({ text: '🤝' });
  });

  it('detects the Teams highfive custom emoji from html payload markers when plain text is empty', () => {
    expect(getSingleEmojiBypassReply({
      messageText: '',
      activityDetails: ['<p><emoji id="highfive" alt="✋" title="High five"></emoji></p>'],
    })).toEqual({
      text: '<p><emoji id="highfive" alt="✋" title="High five"></emoji></p>',
      textFormat: 'xml',
    });
  });

  it('does not trigger for text, multiple emoji, or empty input', () => {
    expect(getSingleEmojiBypassReply({ messageText: 'hello' })).toBeUndefined();
    expect(getSingleEmojiBypassReply({ messageText: '👋👋' })).toBeUndefined();
    expect(getSingleEmojiBypassReply({ messageText: '👋 hi' })).toBeUndefined();
    expect(getSingleEmojiBypassReply({ messageText: '   ' })).toBeUndefined();
  });
});