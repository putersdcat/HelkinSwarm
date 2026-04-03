import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('pending intent replay impairment routing source guards', () => {
  it('passes impairment context into replay limbic decisions and sends a visible defer notice', () => {
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');

    expect(replaySource).toContain('getConsciousLaneAssessmentForTurn(intent.modelOverride)');
    expect(replaySource).toContain('classifyRequestedTaskComplexity({');
    expect(replaySource).toContain('consciousModelImpaired: consciousLane.isImpaired');
    expect(replaySource).toContain('requestedTaskComplexity');
    expect(replaySource).toContain("if (ingressDecision.decision === 'defer') {");
    expect(replaySource).toContain('await sendReply({');
    expect(replaySource).toContain('deferred replay of your queued heavier turn');
    expect(replaySource).toContain("action: 'deferred'");
  });
});