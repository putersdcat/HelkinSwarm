import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /forge routing', () => {
  it('passes a structured skillForgeRequest into raiseToOverseer', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain('⌛ Working on it... (⚙️ SkillForge)');
    expect(source).toContain('await savePendingAckId');
    expect(source).toContain('await this.raiseToOverseer(');
    expect(source).toContain('skillForgeRequest');
    expect(source).toContain('SkillForge failed before it could start');
  });
});
