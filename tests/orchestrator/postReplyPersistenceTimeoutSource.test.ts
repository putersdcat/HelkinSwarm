import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('post-reply persistence timeout source guards', () => {
  it('bounds best-effort memory and chrono persistence so reply-tail stalls do not pin the living session', () => {
    const storeMemorySource = readFileSync('src/orchestrator/storeMemoryActivity.ts', 'utf8');
    const chronoSource = readFileSync('src/orchestrator/chronoBackplane.ts', 'utf8');

    expect(storeMemorySource).toContain('STORE_MEMORY_TIMEOUT_MS = 10_000');
    expect(storeMemorySource).toContain('await withTimeout(');
    expect(storeMemorySource).toContain('mm.storeConversationTurn(input.userMessage, input.assistantReply)');
    expect(storeMemorySource).toContain('[storeMemoryActivity] Skipping memory write after timeout/error:');

    expect(chronoSource).toContain('CHRONO_ACTIVITY_TIMEOUT_MS = 5_000');
    expect(chronoSource).toContain('const doc = await withActivityTimeout(saveChronoContinuity(input), CHRONO_ACTIVITY_TIMEOUT_MS);');
    expect(chronoSource).toContain('[saveChronoContinuityActivity] Skipping chrono persistence after timeout/error:');
  });
});