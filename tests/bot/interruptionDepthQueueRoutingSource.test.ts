import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('bot interruption depth queue routing source guards', () => {
  it('queues turns when the interruption depth cap is reached on bot and replay paths', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');

    expect(botSource).toContain("type RaiseToOverseerResult =");
    expect(botSource).toContain("resolveActiveOverseerSummary");
    expect(botSource).toContain('Math.max(0, activeSummary.activeCount - 1)');
    expect(botSource).toContain("creationReason: 'interruption-depth-cap'");
    expect(botSource).toContain("outcome: 'queued'");
    expect(botSource).toContain('replaceAckWithQueuedNotice');
    expect(replaySource).toContain("resolveActiveOverseerSummary");
    expect(replaySource).toContain('Math.max(0, activeSummary.activeCount - 1)');
    expect(replaySource).toContain("if (ingressDecision.decision === 'queue') {");
    expect(replaySource).toContain("action: 'deferred'");
  });
});