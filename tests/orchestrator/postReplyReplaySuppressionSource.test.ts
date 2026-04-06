import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('post-reply replay suppression source guards', () => {
  it('suppresses same-correlation session re-entry once a session execution is already claimed and still honors the late reply claim guard', () => {
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const promptSource = readFileSync('src/orchestrator/buildPromptActivity.ts', 'utf8');
    const llmSource = readFileSync('src/orchestrator/llmActivity.ts', 'utf8');
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const telemetryActivitySource = readFileSync('src/orchestrator/emitOrchestratorTelemetryActivity.ts', 'utf8');
    const guardSource = readFileSync('src/orchestrator/sessionReplayGuardActivity.ts', 'utf8');
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');

    expect(sessionSource).toContain("'sessionReplayGuardActivity'");
    expect(sessionSource).toContain("authority: 'post-reply-activity-replay-suppression'");
    expect(sessionSource).toContain('if (prompt.replyAlreadyDelivered) {');
    expect(sessionSource).toContain('if (llmResult.replyAlreadyDelivered) {');
    expect(sessionSource).toContain("authority: 'post-reply-replay-suppression'");
    expect(sessionSource).toContain('duplicateReplaySuppressed: true,');

    expect(promptSource).toContain('const conversationId = input.conversationId ?? input.state.conversationId;');
    expect(promptSource).toContain("hasOutboundArtifactClaim(conversationId, 'reply', input.correlationId)");
    expect(promptSource).toContain('return buildReplyAlreadyDeliveredPrompt();');

    expect(llmSource).toContain("hasOutboundArtifactClaim(input.conversationId, 'reply', input.correlationId)");
    expect(llmSource).toContain("replyAlreadyDelivered: true,");

    expect(telemetryActivitySource).toContain("df.app.activity('emitOrchestratorTelemetryActivity'");

    expect(overseerSource).toContain('if (sessionResult.duplicateReplaySuppressed) {');
    expect(overseerSource).toContain('duplicateReplaySuppressed: true,');

    expect(guardSource).toContain("import { claimOutboundArtifact, hasOutboundArtifactClaim } from '../bot/conversationStore.js';");
    expect(guardSource).toContain("hasOutboundArtifactClaim(input.conversationId, 'reply', input.correlationId)");
    expect(guardSource).toContain("'session-execution'");
    expect(guardSource).toContain('return !claimedSessionExecution;');
    expect(indexSource).toContain("import '../orchestrator/emitOrchestratorTelemetryActivity.js';");
    expect(indexSource).toContain("import '../orchestrator/sessionReplayGuardActivity.js';");
  });
});