import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('self awaken timer source guards', () => {
  it('registers the timer and routes due chrono wakes through the self-awaken ingress path', () => {
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');
    const timerSource = readFileSync('src/functions/selfAwakenTimer.ts', 'utf8');

    expect(indexSource).toContain("import './selfAwakenTimer.js';");
    expect(timerSource).toContain("app.timer('selfAwakenTimer'");
    expect(timerSource).toContain('listDueChronoScheduledWakes()');
    expect(timerSource).toContain("source: 'self-awaken'");
    expect(timerSource).toContain('getConsciousLaneAssessmentForTurn()');
    expect(timerSource).toContain('classifyRequestedTaskComplexity({');
    expect(timerSource).toContain('consciousModelImpaired: consciousLane.isImpaired');
    expect(timerSource).toContain("if (ingressDecision.decision === 'defer') {");
    expect(timerSource).toContain('await deferChronoScheduledWake(wake.id, wake.userId, nextWakeAt, ingressDecision.reason);');
    expect(timerSource).toContain('const activeSessionRoutable = hasActiveGuard');
    expect(timerSource).toContain("await client.raiseEvent(effectiveActiveInstanceId, 'NewMessage', event);");
    expect(timerSource).toContain('await queueBufferedNewMessage(event, wake.userId, effectiveActiveInstanceId);');
    expect(timerSource).toContain("await client.raiseEvent(effectiveActiveInstanceId, 'BufferedIngressQueued', {");
    expect(timerSource).toContain('await sendReply({');
    expect(timerSource).toContain("name: 'ChronoScheduledWakeDeferred'");
    expect(timerSource).toContain('await markChronoScheduledWakeDispatched(wake.id, wake.userId, correlationId);');
    expect(timerSource).toContain("name: 'ChronoScheduledWakeTriggered'");
  });
});