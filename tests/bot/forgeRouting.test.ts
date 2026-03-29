import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /forge routing', () => {
  it('passes a structured skillForgeRequest into raiseToOverseer', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain('buildSkillForgePrototype');
    expect(source).toContain('SkillForge accepted the request. Preparing the prototype bundle');
    expect(source).toContain('prototype.summary');
    expect(source).toContain('splitReplyIntoChunks(prototype.summary)');
    expect(source).toContain('await context.sendActivity({');
    expect(source).toContain('SkillForge failed before it could start');
  });
});
