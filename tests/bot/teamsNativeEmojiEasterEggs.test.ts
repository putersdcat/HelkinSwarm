import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTeamsNativeEmojiEasterEggReply,
  hasHeartEyesRobotSignal,
  hasHighFiveSignal,
  resetTeamsNativeEmojiEasterEggCache,
} from '../../src/bot/teamsNativeEmojiEasterEggs.js';

describe('Teams native emoji easter egg detection', () => {
  beforeEach(() => {
    resetTeamsNativeEmojiEasterEggCache();
  });

  it('detects RobotLove shortcode, raw unicode, and native Teams heart-eyes robot payloads', () => {
    expect(hasHeartEyesRobotSignal({ messageText: ':hearteyesrobot:' })).toBe(true);
    expect(hasHeartEyesRobotSignal({ messageText: '🤖❤️👀' })).toBe(true);
    expect(hasHeartEyesRobotSignal({
      messageText: '',
      activityDetails: ['<p><emoji id="hearteyesrobot" alt="😍" title="Heart eyes robot"></emoji></p>'],
    })).toBe(true);
    expect(hasHeartEyesRobotSignal({
      messageText: '',
      activityDetails: ['{"title":"Heart eyes robot","alt":"😍"}'],
    })).toBe(true);
  });

  it('detects native Teams highfive payloads from id or title phrasing', () => {
    expect(hasHighFiveSignal({
      messageText: '',
      activityDetails: ['<p><emoji id="highfive" alt="✋" title="High five"></emoji></p>'],
    })).toBe(true);
    expect(hasHighFiveSignal({
      messageText: '',
      activityDetails: ['{"title":"High five","alt":"✋"}'],
    })).toBe(true);
  });

  it('returns the RobotLove gif attachment when the asset exists', async () => {
    const reply = await buildTeamsNativeEmojiEasterEggReply({ messageText: ':hearteyesrobot:' });

    expect(reply?.kind).toBe('robot-love');
    expect(reply?.attachments?.[0]).toMatchObject({
      contentType: 'image/gif',
      name: 'RobotLove.gif',
    });
    expect(reply?.attachments?.[0]?.contentUrl).toContain('data:image/gif;base64,');
  });

  it('falls back to text when RobotLove gif cannot be loaded', async () => {
    const reply = await buildTeamsNativeEmojiEasterEggReply(
      { messageText: ':hearteyesrobot:' },
      { readFileImpl: async () => { throw new Error('missing gif'); } },
    );

    expect(reply).toEqual({ kind: 'robot-love', text: '🤖❤️👀 Robot love detected!' });
  });

  it('returns the blog-style highfive shortcode for the Teams highfive signal', async () => {
    const reply = await buildTeamsNativeEmojiEasterEggReply({
      messageText: '',
      activityDetails: ['<p><emoji id="highfive" alt="✋" title="High five"></emoji></p>'],
    });

    expect(reply).toEqual({
      kind: 'highfive',
      text: '(highfive)',
      textFormat: 'plain',
    });
  });

  it('does not trigger for unrelated messages or other emoji-only payloads', async () => {
    expect(hasHeartEyesRobotSignal({ messageText: 'hello' })).toBe(false);
    expect(hasHighFiveSignal({ messageText: '', activityDetails: ['{"title":"Crying"}'] })).toBe(false);
    expect(await buildTeamsNativeEmojiEasterEggReply({ messageText: '👋' })).toBeUndefined();
  });
});