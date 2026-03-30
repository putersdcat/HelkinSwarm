import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /forge promote fallback reply', () => {
  it('turns GitHub contents permission problems into a guided fallback instead of a raw failure blob', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("result.status === 'promoted'");
    expect(source).toContain('GitHub promotion is blocked for');
    expect(source).toContain('No repository files were changed by this bot command.');
    expect(source).toContain('result.nextSteps');
  });
});