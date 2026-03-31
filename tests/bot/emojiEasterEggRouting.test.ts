import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot single emoji easter egg routing', () => {
  it('replies with the same emoji before prompt shields and the normal ack path', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("import { getSingleEmojiBypassReply } from './emojiEasterEggs.js';");
    expect(source).toContain('const singleEmojiBypass = getSingleEmojiBypassReply({');
    expect(source).toContain('activityDetails: [');
    expect(source).toContain('JSON.stringify(context.activity.channelData ?? {})');
    expect(source).toContain('textFormat: singleEmojiBypass.textFormat');
    expect(source).toContain('// Parse DevLoop protocol markers (#147) — must happen before shields check');
    expect(source.indexOf('const singleEmojiBypass = getSingleEmojiBypassReply({')).toBeLessThan(
      source.indexOf('// Parse DevLoop protocol markers (#147) — must happen before shields check'),
    );
  });
});