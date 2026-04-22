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

  it('[#711] recovered branch performs inline finalization (no reliance on post-loop continuation)', () => {
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');

    // Locate the recovered branch.
    const branchStart = overseerSource.indexOf('if (replyDeliveryRecovery.recovered) {');
    expect(branchStart, 'recovered branch must exist').toBeGreaterThan(-1);
    // Take a generous slice — branch ends at the closing brace + return.
    const branchSlice = overseerSource.slice(branchStart, branchStart + 4000);

    // Inline-finalization required actions, all WITHIN the recovered branch.
    expect(branchSlice).toContain("'terminateOrchestrationActivity'");
    expect(branchSlice).toContain("'PolicyOverrideApplied'");
    expect(branchSlice).toContain("'ingressWindowStageActivity'");
    expect(branchSlice).toContain("action: 'clear',");
    expect(branchSlice).toContain('signalEntity');
    expect(branchSlice).toContain('MIND_SESSION_GUARD_ENTITY_NAME');
    expect(branchSlice).toContain("'release'");
    expect(branchSlice).toContain("'TurnCompleted'");
    expect(branchSlice).toContain('recoveredViaReplyDelivery: true');
    // Must return directly from the branch — no `break` to fall through to
    // the post-loop continuation path that was silently parking.
    expect(branchSlice).toMatch(/return\s+\{[\s\S]*completedCorrelationId:\s*correlationId/);
    expect(branchSlice).not.toMatch(/^\s*break;\s*$/m);
  });
});