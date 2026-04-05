import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('model override ack recovery source guards', () => {
  it('arms a short-horizon local stale-ack recovery watchdog for override turns', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain('MODEL_OVERRIDE_ACK_RECOVERY_DELAY_MS = 45_000');
    expect(source).toContain('private scheduleModelOverrideAckRecovery(');
    expect(source).toContain('const pendingAckId = await getPendingAckId(correlationId);');
    expect(source).toContain('if (pendingAckId !== ackActivityId) {');
    expect(source).toContain('const activeTurnStages = await getActiveTurnStagesForUser(userId);');
    expect(source).toContain('if (activeTurnStages.some((entry) => entry.correlationId === correlationId)) {');
    expect(source).toContain('await recoverStaleAck(');
    expect(source).toContain("console.warn('[HelkinSwarmBot] model-override ack recovery failed:'");
    expect(source).toContain('this.scheduleModelOverrideAckRecovery(context, userId, correlationId, ackResponse.id);');
  });
});