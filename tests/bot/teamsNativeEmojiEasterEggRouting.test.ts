import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot Teams native emoji easter egg routing', () => {
  it('routes RobotLove and highfive easter eggs before prompt shields and the normal ack path', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const helperSource = readFileSync('src/bot/teamsNativeEmojiEasterEggs.ts', 'utf8');
    const dockerfile = readFileSync('Dockerfile', 'utf8');

    expect(source).toContain("import { buildTeamsNativeEmojiEasterEggReply } from './teamsNativeEmojiEasterEggs.js';");
    expect(source).toContain('const nativeEmojiEasterEggReply = await buildTeamsNativeEmojiEasterEggReply({');
    expect(source).toContain("if (nativeEmojiEasterEggReply.kind === 'robot-love') {");
    expect(source).toContain('await this.offerRobotLoveAnimationFile(');
    expect(source).toContain("contentType: 'application/vnd.microsoft.teams.card.file.consent'");
    expect(source).toContain('JSON.stringify(context.activity),');
    expect(source).toContain('attachments: nativeEmojiEasterEggReply.attachments');
    expect(source).toContain('// Parse DevLoop protocol markers (#147) — must happen before shields check');
    expect(source.indexOf('const nativeEmojiEasterEggReply = await buildTeamsNativeEmojiEasterEggReply({')).toBeLessThan(
      source.indexOf('// Parse DevLoop protocol markers (#147) — must happen before shields check'),
    );

    expect(helperSource).toContain("const HEART_EYES_ROBOT_SHORTCODE = ':hearteyesrobot:';");
  expect(helperSource).toContain("const HIGHFIVE_SHORTCODE = '(highfive)';");
    expect(helperSource).toContain('HEART_EYES_ROBOT_PHRASE_PATTERN');
    expect(helperSource).toContain('HIGHFIVE_PHRASE_PATTERN');
    expect(helperSource).toContain('RobotLove.gif');

    expect(dockerfile).toContain('COPY visualAssets/ ./visualAssets/');
  });
});