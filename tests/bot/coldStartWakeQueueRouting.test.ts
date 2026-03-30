import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot cold-start wake-up queue routing', () => {
  it('queues cold-start turns for automatic replay instead of dropping them behind a retry prompt', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');

    expect(source).toContain("if (isColdStarting()) {");
    expect(source).toContain("creationReason: 'cold-start-wake-up'");
    expect(source).toContain('HelkinSwarm is waking up from scale-to-zero. I queued this exact message for automatic replay');
    expect(source).toContain("await replayPendingIntent(");
    expect(replaySource).toContain("return `pending-intent-${intent.id}`;");
  });

  it('preserves the original turn correlation on queued pending intents for replay telemetry', () => {
    const storeSource = readFileSync('src/orchestrator/pendingIntentStore.ts', 'utf8');

    expect(storeSource).toContain('correlationId: z.string().optional()');
    expect(storeSource).toContain('correlationId: input.correlationId ?? id');
    expect(storeSource).toContain("creationReason: input.creationReason ?? 'overseer-unreachable'");
    expect(storeSource).toContain('userNotified: input.userNotified ?? false');
  });
});