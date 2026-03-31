import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /assetingest selftest routing', () => {
  it('routes the inbound asset ingestion self-test through the normal overseer path', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("if (lowerMessage.startsWith('/assetingest selftest')) {");
    expect(source).toContain('await this.handleAssetIngestSelfTest(context, userId, userAlias, messageText);');
    expect(source).toContain('private async handleAssetIngestSelfTest(');
    expect(source).toContain('⌛ Running inbound asset ingestion self-test');
    expect(source).toContain('const ingested = await ingestTeamsAttachments({');
    expect(source).toContain('asset-ingest-selftest.png');
    expect(source).toContain('asset-ingest-selftest.txt');
    expect(source).toContain('For this inbound attachment ingestion self-test, report the runtime assets available in this turn.');
    expect(source).toContain('Forward only runtime asset');
    expect(source).toMatch(/assetIngestPrompt,[\s\S]*modelOverride,[\s\S]*undefined,[\s\S]*ingested\.runtimeAssets,/);
    expect(source).toContain('await this.raiseToOverseer(');
  });
});