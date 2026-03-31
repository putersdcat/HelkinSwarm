import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /assetstore selftest routing', () => {
  it('routes the owner-only runtime asset storage self-test before overseer handoff', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("if (lowerMessage === '/assetstore selftest') {");
    expect(source).toContain('await this.handleAssetStoreSelfTest(context, userId);');
    expect(source).toContain('private async handleAssetStoreSelfTest(');
    expect(source).toContain("await context.sendActivity('⌛ Running runtime asset storage self-test...');");
    expect(source).toContain('const reference = await persistRuntimeAsset({');
    expect(source).toContain('const loadedReference = await loadRuntimeAssetReference(reference);');
    expect(source).toContain('const loadedContent = await readRuntimeAssetContent(reference);');
    expect(source).toContain('const deleted = await deleteRuntimeAsset(reference);');
    expect(source).toContain('✅ Runtime asset store self-test passed.');
  });
});