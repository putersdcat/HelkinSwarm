import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('living session ingress window source guards', () => {
  it('opens an awaiting-ingress stage and drains a second NewMessage in the same overseer instance', () => {
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const activitySource = readFileSync('src/orchestrator/ingressWindowStageActivity.ts', 'utf8');
    const bufferedIngressSource = readFileSync('src/orchestrator/bufferedIngressActivity.ts', 'utf8');

    expect(overseerSource).toContain("context.df.waitForExternalEvent('NewMessage')");
    expect(overseerSource).toContain("action: 'mark-active-processing'");
    expect(overseerSource).toContain("action: 'dequeue-new-message'");
    expect(overseerSource).toContain("action: 'open'");
    expect(overseerSource).toContain("action: 'drain'");
    expect(overseerSource).toContain("context.df.setCustomStatus({");
    expect(overseerSource).toContain("stage: 'active-processing'");
    expect(overseerSource).toContain("stage: 'awaiting-ingress'");
    expect(overseerSource).toContain("name: 'TurnStarted'");
    expect(overseerSource).toContain("name: 'TurnCompleted'");
    expect(overseerSource).toContain('const sessionInstanceId = `session-${context.df.instanceId}-${sessionInput.correlationId}`;');
    expect(activitySource).toContain("action: z.literal('mark-active-processing')");
    expect(activitySource).toContain("recordOrchestratorStage(input.correlationId, 'active-processing', input.userId, Date.now(), input.instanceId);");
    expect(activitySource).toContain("recordOrchestratorStage(input.correlationId, 'awaiting-ingress', input.userId, Date.now(), input.instanceId);");
    expect(activitySource).toContain("name: 'LivingSessionIngressWindowOpened'");
    expect(activitySource).toContain("name: 'LivingSessionNewMessageDrained'");
    expect(bufferedIngressSource).toContain("action: z.literal('dequeue-new-message')");
    expect(bufferedIngressSource).toContain('await container.items.upsert(doc);');
    expect(bufferedIngressSource).toContain("name: 'BufferedIngressQueued'");
    expect(bufferedIngressSource).toContain("name: 'BufferedIngressDequeued'");
    expect(bufferedIngressSource).toContain("status: z.enum(['queued', 'dequeued']).default('queued')");
    expect(bufferedIngressSource).toContain("status: 'queued'");
    expect(bufferedIngressSource).toContain("c.status = @status");
    expect(bufferedIngressSource).toContain("status: 'dequeued'");
    expect(bufferedIngressSource).toContain('return dequeueBufferedNewMessageForUser(input.userId);');
  });
});