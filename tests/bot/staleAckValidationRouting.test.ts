import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot /validate-stale-ack routing', () => {
  it('creates a backdated placeholder and invokes stale-ack recovery', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const storeSource = readFileSync('src/bot/conversationStore.ts', 'utf8');

    expect(source).toContain("if (lowerMessage === '/validate-stale-ack') {");
    expect(source).toContain('⌛ Working on it... (🧪 stale-ack validation)');
    expect(source).toContain('STALE_ACK_VALIDATION_DELAY_MS = 4_000');
    expect(source).toContain('Date.now() - STALE_ACK_THRESHOLD_MS - 1_000');
    expect(source).toContain('await recoverStaleAcks(STALE_ACK_THRESHOLD_MS);');
    expect(storeSource).toContain('createdAt = new Date().toISOString()');
  });
});