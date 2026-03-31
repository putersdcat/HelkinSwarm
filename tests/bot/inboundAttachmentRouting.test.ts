import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot inbound attachment routing', () => {
  it('ingests Teams attachments into runtime assets before cold-start queueing and overseer handoff', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');
    const storeSource = readFileSync('src/orchestrator/pendingIntentStore.ts', 'utf8');

    expect(source).toContain('const inboundAssets = await ingestTeamsAttachments({');
    expect(source).toContain('imageUrls: inboundAssets.imageUrls');
    expect(source).toContain('runtimeAssets: inboundAssets.runtimeAssets');
    expect(source).toContain('attachmentNotices: inboundAssets.notices');
    expect(source).toContain('inboundAssets.runtimeAssets');
    expect(replaySource).toContain("...(intent.runtimeAssets.length > 0 ? { runtimeAssets: intent.runtimeAssets } : {})");
    expect(replaySource).toContain("...(intent.attachmentNotices.length > 0 ? { attachmentNotices: intent.attachmentNotices } : {})");
    expect(storeSource).toContain('runtimeAssets: z.array(RuntimeAssetReferenceSchema).default([])');
    expect(storeSource).toContain('attachmentNotices: z.array(z.string()).default([])');
  });
});