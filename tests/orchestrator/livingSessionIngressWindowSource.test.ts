import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('living session ingress window source guards', () => {
  it('opens an awaiting-ingress stage and drains a second NewMessage in the same overseer instance', () => {
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const activitySource = readFileSync('src/orchestrator/ingressWindowStageActivity.ts', 'utf8');

    expect(overseerSource).toContain("context.df.waitForExternalEvent('NewMessage')");
    expect(overseerSource).toContain("action: 'open'");
    expect(overseerSource).toContain("action: 'drain'");
    expect(overseerSource).toContain('const sessionInstanceId = `session-${context.df.instanceId}-${sessionInput.correlationId}`;');
    expect(activitySource).toContain("recordOrchestratorStage(input.correlationId, 'awaiting-ingress', input.userId, Date.now(), input.instanceId);");
    expect(activitySource).toContain("name: 'LivingSessionIngressWindowOpened'");
    expect(activitySource).toContain("name: 'LivingSessionNewMessageDrained'");
  });
});