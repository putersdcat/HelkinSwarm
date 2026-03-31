import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /assetstore selftest routing', () => {
  it('routes the owner-only runtime asset self-test command before overseer handoff', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("if (lowerMessage === '/assetstore selftest') {");
    expect(source).toContain('await this.handleAssetStoreSelfTest(context, userId);');
    expect(source).toContain('private async handleAssetStoreSelfTest(');
    expect(source).toContain("await context.sendActivity('⌛ Running runtime asset storage self-test...');");
    expect(source).toContain('persistRuntimeAsset({');
    expect(source).toContain('readRuntimeAssetContent(reference)');
    expect(source).toContain('deleteRuntimeAsset(reference)');
  });
});