import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('bot impairment defer routing source guards', () => {
  it('passes conscious-lane impairment context into limbic ingress and handles deferred turns', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(botSource).toContain('getConsciousLaneAssessmentForTurn(modelOverride)');
    expect(botSource).toContain('classifyRequestedTaskComplexity({');
    expect(botSource).toContain('consciousModelImpaired: consciousLane.isImpaired');
    expect(botSource).toContain('requestedTaskComplexity');
    expect(botSource).toContain("ingressDecision.decision === 'queue' || ingressDecision.decision === 'defer'");
    expect(botSource).toContain("creationReason = ingressDecision.decision === 'defer'");
    expect(botSource).toContain("outcome: ingressDecision.decision === 'defer' ? 'deferred' : 'queued'");
    expect(botSource).toContain('replaceAckWithDeferredNotice');
    expect(botSource).toContain('retry with /heavy for full reasoning');
  });
});