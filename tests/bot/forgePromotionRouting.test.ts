import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /forge promote routing', () => {
  it('routes the promotion command before the generic /forge handler and calls the promotion helper', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("if (lowerMessage.startsWith('/forge promote')) {");
    expect(source).toContain('await this.handleForgePromote(context, userId, messageText);');
    expect(source).toContain('promoteSkillForgeBundle(bundlePath)');
    expect(source).toContain('Promoting SkillForge bundle into tracked repository files');
  });
});