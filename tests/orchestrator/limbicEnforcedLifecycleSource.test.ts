import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('limbic enforced lifecycle source guards', () => {
  it('routes every currently-supported external ingress source through limbic decisioning', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');
    const hookReceiver = readFileSync('src/functions/hookReceiver.ts', 'utf8');
    const graphNotificationHandler = readFileSync('src/functions/graphNotificationHandler.ts', 'utf8');
    const devLoopRelay = readFileSync('src/functions/devLoopRelay.ts', 'utf8');
    const selfAwakenTimer = readFileSync('src/functions/selfAwakenTimer.ts', 'utf8');

    expect(botSource).toContain('recordLimbicIngressDecision({');
    expect(botSource).toContain("source: 'teams-message'");

    expect(replaySource).toContain('recordLimbicIngressDecision({');
    expect(replaySource).toContain("source: 'pending-intent-replay'");

    expect(hookReceiver).toContain('recordLimbicIngressDecision({');
    expect(hookReceiver).toContain("source: 'hook-fired'");

    expect(graphNotificationHandler).toContain('recordLimbicIngressDecision({');
    expect(graphNotificationHandler).toContain("source: 'graph-notification'");

    expect(devLoopRelay).toContain('recordLimbicIngressDecision({');
    expect(devLoopRelay).toContain("source: 'devloop-relay'");

    expect(selfAwakenTimer).toContain('recordLimbicIngressDecision({');
    expect(selfAwakenTimer).toContain("source: 'self-awaken'");
  });

  it('injects steering before prompt assembly and keeps sub-session failure as returned data', () => {
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const subAgentSource = readFileSync('src/orchestrator/subAgentActivity.ts', 'utf8');

    expect(sessionSource).toContain("'steeringInjectionActivity'");
    expect(sessionSource.indexOf("'steeringInjectionActivity'"))
      .toBeLessThan(sessionSource.indexOf("'buildPromptActivity'"));

    expect(subAgentSource).toContain('catch (err) {');
    expect(subAgentSource).toContain("name: 'SubAgentToolExecuted'");
    expect(subAgentSource).toContain('success: false,');
    expect(subAgentSource).toContain('error: err instanceof Error ? err.message : String(err),');
  });
});