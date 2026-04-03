import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('bot interruption depth queue routing source guards', () => {
  it('queues turns when the interruption depth cap is reached on bot and replay paths', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');
    const limbicSource = readFileSync('src/orchestrator/limbicIngressActivity.ts', 'utf8');

    expect(botSource).toContain("type RaiseToOverseerResult =");
    expect(botSource).toContain("getActiveTurnCountForUser");
    expect(botSource).toContain('Math.max(0, activeTurnCount - 1)');
    expect(botSource).toContain("const creationReason = interruptionDepth >= MAX_INTERRUPTION_DEPTH");
    expect(botSource).toContain("'single-session-enforcement'");
    expect(botSource).toContain("outcome: 'queued'");
    expect(botSource).toContain('replaceAckWithQueuedNotice');
    expect(botSource).toContain('I already have active work in flight');
    expect(replaySource).toContain("getActiveTurnCountForUser");
    expect(replaySource).toContain('Math.max(0, activeTurnCount - 1)');
    expect(replaySource).toContain("if (ingressDecision.decision === 'queue') {");
    expect(replaySource).toContain("action: 'deferred'");
    expect(limbicSource).toContain("if (input.hasActiveSession) {");
    expect(limbicSource).toContain('Single-session enforcement is active');
  });
});