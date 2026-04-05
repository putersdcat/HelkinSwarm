import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('reply delivery recovery source guards', () => {
  it('recovers a turn when the reply claim exists and the pending ack is already gone', () => {
    const recoverySource = readFileSync('src/orchestrator/replyDeliveryRecoveryActivity.ts', 'utf8');
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');

    expect(recoverySource).toContain("await hasOutboundArtifactClaim(input.conversationId, 'reply', input.correlationId)");
    expect(recoverySource).toContain("const pendingAckPresent = (await getPendingAckId(input.correlationId)) !== null;");
    expect(recoverySource).toContain('recovered: replyClaimExists && !pendingAckPresent,');

    expect(overseerSource).toContain("'replyDeliveryRecoveryActivity'");
    expect(overseerSource).toContain("authority: 'reply-delivery-recovery'");
    expect(overseerSource).toContain("duplicateReplaySuppressed: true,");
    expect(overseerSource).toContain('Recovered reply-delivered turn after missing sub-orchestrator completion');

    expect(indexSource).toContain("import '../orchestrator/replyDeliveryRecoveryActivity.js';");
  });
});