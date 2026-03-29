import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /forge routing', () => {
  it('passes a structured skillForgeRequest into raiseToOverseer', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("'⌛ Working on SkillForge prototype...'");
    expect(source).toContain('{ idea }');
    expect(source).toContain('skillForgeRequest?: NewMessageEvent[\'skillForgeRequest\']');
  });
});
