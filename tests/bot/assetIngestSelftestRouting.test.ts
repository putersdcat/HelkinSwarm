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
    expect(source).toContain('List each filename, content type, attachment kind, and asset ID');
    expect(source).toContain('inline-email <recipient>');
    expect(source).toContain('Use the exact tool outlook_send_email.');
    expect(source).toContain('asset-ingest-selftest');
    expect(source).toContain('outlook_send_email with inlineAssets on the real deployed path');
    expect(source).toMatch(/assetIngestPrompt,[\s\S]*modelOverride,[\s\S]*undefined,[\s\S]*ingested\.runtimeAssets,/);
    expect(source).toContain('await this.raiseToOverseer(');
  });
});