import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('session execution replay guard source guards', () => {
  it('claims a same-correlation execution marker before prompt/llm work so duplicate sessions cannot start a second pre-reply pass', () => {
    const conversationStoreSource = readFileSync('src/bot/conversationStore.ts', 'utf8');
    const guardSource = readFileSync('src/orchestrator/sessionReplayGuardActivity.ts', 'utf8');
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(conversationStoreSource).toContain("export type OutboundArtifactKind = 'reply' | 'confirmation-card' | 'email-send' | 'session-execution';");
    expect(conversationStoreSource).toContain('ownerInstanceId?: string;');
    expect(conversationStoreSource).toContain('export async function getOutboundArtifactClaim(');
    expect(guardSource).toContain("if (await hasOutboundArtifactClaim(input.conversationId, 'reply', input.correlationId)) {");
    expect(guardSource).toContain("const existingSessionExecutionClaim = await getOutboundArtifactClaim(");
    expect(guardSource).toContain("const claimedSessionExecution = await claimOutboundArtifact(");
    expect(guardSource).toContain("'session-execution',");
    expect(guardSource).toContain('input.sessionInstanceId,');
    expect(guardSource).toContain('ownerInstanceId !== input.sessionInstanceId');
    expect(sessionSource).toContain("'sessionReplayGuardActivity'");
    expect(sessionSource).toContain('sessionInstanceId: context.df.instanceId,');
    expect(sessionSource).toContain("duplicateReplaySuppressed: true,");
  });
});