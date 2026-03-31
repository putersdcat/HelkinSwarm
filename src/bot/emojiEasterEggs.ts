const emojiSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const letterOrNumberPattern = /[\p{Letter}\p{Number}]/u;
const emojiPresentationPattern = /\p{Extended_Pictographic}/u;
const teamsHighFiveHtml = '<p><emoji id="highfive" alt="✋" title="High five"></emoji></p>';
const teamsHighFiveTagPattern = /<emoji\b[^>]*\bid=["']highfive["'][^>]*>/i;
const teamsHighFiveJsonPattern = /"(?:id|name|shortcode|type)"\s*:\s*"highfive"/i;

export interface EmojiBypassReply {
  text: string;
  textFormat?: 'plain' | 'markdown' | 'xml';
}

export interface EmojiBypassInput {
  messageText: string;
  activityText?: string;
  activityDetails?: string[];
}

function hasTeamsHighFiveMarkup(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return teamsHighFiveTagPattern.test(value) || teamsHighFiveJsonPattern.test(value);
}

/**
 * Returns the exact emoji to mirror back when the entire trimmed message is a
 * single emoji grapheme cluster. Otherwise returns undefined.
 */
export function getSingleEmojiBypassReply(input: EmojiBypassInput): EmojiBypassReply | undefined {
  const trimmed = input.messageText.trim();
  if (!trimmed) {
    const activitySignals = [input.activityText, ...(input.activityDetails ?? [])];
    if (activitySignals.some((value) => hasTeamsHighFiveMarkup(value))) {
      return {
        text: teamsHighFiveHtml,
        textFormat: 'xml',
      };
    }

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

  return { text: segment };
}