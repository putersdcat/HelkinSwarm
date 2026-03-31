const emojiSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const letterOrNumberPattern = /[\p{Letter}\p{Number}]/u;
const emojiPresentationPattern = /\p{Extended_Pictographic}/u;

/**
 * Returns the exact emoji to mirror back when the entire trimmed message is a
 * single emoji grapheme cluster. Otherwise returns undefined.
 */
export function getSingleEmojiBypassReply(messageText: string): string | undefined {
  const trimmed = messageText.trim();
  if (!trimmed) {
    return undefined;
  }

  const segments = Array.from(emojiSegmenter.segment(trimmed), (entry) => entry.segment);
  if (segments.length !== 1) {
    return undefined;
  }

  const [segment] = segments;
  if (!segment || letterOrNumberPattern.test(segment) || !emojiPresentationPattern.test(segment)) {
    return undefined;
  }

  return segment;
}