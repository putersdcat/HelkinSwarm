import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot RobotLove easter egg routing', () => {
  it('routes the narrow RobotLove easter egg before prompt shields and the normal ack path', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const helperSource = readFileSync('src/bot/robotLoveEasterEgg.ts', 'utf8');
    const dockerfile = readFileSync('Dockerfile', 'utf8');

    expect(source).toContain("import { buildRobotLoveEasterEggReply } from './robotLoveEasterEgg.js';");
    expect(source).toContain('const robotLoveEasterEggReply = await buildRobotLoveEasterEggReply({');
    expect(source).toContain('JSON.stringify(context.activity),');
    expect(source).toContain('attachments: robotLoveEasterEggReply.attachments');
    expect(source).toContain('// Parse DevLoop protocol markers (#147) — must happen before shields check');
    expect(source.indexOf('const robotLoveEasterEggReply = await buildRobotLoveEasterEggReply({')).toBeLessThan(
      source.indexOf('// Parse DevLoop protocol markers (#147) — must happen before shields check'),
    );

    expect(helperSource).toContain("const HEART_EYES_ROBOT_SHORTCODE = ':hearteyesrobot:';");
    expect(helperSource).toContain('hearteyesrobot');
    expect(helperSource).toContain("RobotLove.gif");
    expect(helperSource).toContain('🤖❤️👀 Robot love detected!');
    expect(helperSource).toContain("resolve(process.cwd(), 'visualAssets', 'EggsOfEaster', 'RobotLove.gif')");

    expect(dockerfile).toContain('COPY visualAssets/ ./visualAssets/');
  });
});