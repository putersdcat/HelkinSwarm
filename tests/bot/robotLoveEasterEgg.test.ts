import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildRobotLoveEasterEggReply,
  isHeartEyesRobotTrigger,
  resetRobotLoveEasterEggCache,
} from '../../src/bot/robotLoveEasterEgg.js';

describe('RobotLove easter egg detection', () => {
  beforeEach(() => {
    resetRobotLoveEasterEggCache();
  });

  it('detects shortcode, raw unicode, and Teams custom heart-eyes robot payloads', () => {
    expect(isHeartEyesRobotTrigger({ messageText: ':hearteyesrobot:' })).toBe(true);
    expect(isHeartEyesRobotTrigger({ messageText: '🤖❤️👀' })).toBe(true);
    expect(isHeartEyesRobotTrigger({
      messageText: '',
      activityDetails: ['<p><emoji id="hearteyesrobot" alt="😍" title="Heart eyes robot"></emoji></p>'],
    })).toBe(true);
    expect(isHeartEyesRobotTrigger({
      messageText: '',
      activityDetails: ['{"type":"message","text":"","entities":[],"channelData":{"text":"<p><emoji id=\"hearteyesrobot\" alt=\"😍\" title=\"Heart eyes robot\"></emoji></p>"}}'],
    })).toBe(true);
  });

  it('returns the RobotLove gif attachment when the asset exists', async () => {
    const reply = await buildRobotLoveEasterEggReply({ messageText: ':hearteyesrobot:' });

    expect(reply?.attachments?.[0]).toMatchObject({
      contentType: 'image/gif',
      name: 'RobotLove.gif',
    });
    expect(reply?.attachments?.[0]?.contentUrl).toContain('data:image/gif;base64,');
  });

  it('falls back to text when the gif cannot be loaded', async () => {
    const reply = await buildRobotLoveEasterEggReply(
      { messageText: ':hearteyesrobot:' },
      { readFileImpl: async () => { throw new Error('missing gif'); } },
    );

    expect(reply).toEqual({ text: '🤖❤️👀 Robot love detected!' });
  });

  it('does not trigger for unrelated messages', async () => {
    expect(isHeartEyesRobotTrigger({ messageText: 'hello' })).toBe(false);
    expect(await buildRobotLoveEasterEggReply({ messageText: '👋' })).toBeUndefined();
  });
});