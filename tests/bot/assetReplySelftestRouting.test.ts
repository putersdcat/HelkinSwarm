import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /assetreply selftest routing', () => {
  it('routes the owner-only outbound asset reply self-test before overseer handoff', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("if (lowerMessage === '/assetreply selftest') {");
    expect(source).toContain('await this.handleAssetReplySelfTest(context, userId);');
    expect(source).toContain('private async handleAssetReplySelfTest(');
    expect(source).toContain("await context.sendActivity('⌛ Running outbound asset reply self-test...');");
    expect(source).toContain('await sendReply({');
    expect(source).toContain('assets: [');
  });
});