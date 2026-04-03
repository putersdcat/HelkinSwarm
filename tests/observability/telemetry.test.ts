import { describe, expect, it } from 'vitest';
import { trackEvent } from '../../src/observability/telemetry.js';
import { getTraceTree } from '../../src/observability/sessionTracer.js';
import {
  evaluateLimbicIngress,
  recordLimbicIngressDecision,
} from '../../src/orchestrator/limbicIngressActivity.js';
import { MAX_INTERRUPTION_DEPTH } from '../../src/orchestrator/mindSessionGuard.js';

describe('telemetry trace detail enrichment', () => {
  it('records auth method/source/scope details in the runtime trace for proof workflows', () => {
    const correlationId = 'telemetry-proof-330';

    trackEvent({
      name: 'ScopedTokenMinted',
      correlationId,
      userId: 'u1',
      properties: {
        toolName: 'outlook_reply_to_latest_email',
        method: 'obo',
        scope: 'write',
        acquisition: 'silent',
      },
    });

    trackEvent({
      name: 'HandlerTokenSource',
      correlationId,
      userId: 'u1',
      properties: {
        handler: 'outlook',
        source: 'scoped',
        scopedTokenMethod: 'obo',
        scopedTokenScope: 'write',
      },
    });

    const trace = getTraceTree(correlationId);
    expect(trace).toBeDefined();

    const mintPhase = trace?.phases.find((phase) => phase.name === 'ScopedTokenMinted');
    expect(mintPhase?.detail).toContain('tool: outlook_reply_to_latest_email');
    expect(mintPhase?.detail).toContain('method: obo');
    expect(mintPhase?.detail).toContain('scope: write');
    expect(mintPhase?.detail).toContain('acquisition: silent');

    const handlerPhase = trace?.phases.find((phase) => phase.name === 'HandlerTokenSource');
    expect(handlerPhase?.detail).toContain('method: obo');
    expect(handlerPhase?.detail).toContain('scope: write');
    expect(handlerPhase?.detail).toContain('source: scoped');
    expect(handlerPhase?.detail).toContain('handler: outlook');
  });

  it('records autonomic execution-kind details for sub-agent and direct-dispatch proof workflows', () => {
    const correlationId = 'corr-526-proof';

    trackEvent({
      name: 'SubAgentSpawned',
      correlationId,
      userId: 'u1',
      properties: {
        toolName: 'outlook_list_emails',
        executionKind: 'instrumental-sub-session',
        returnsControlTo: 'conscious-thread',
        contextBoundary: 'minimal-scoped-context',
      },
    });

    trackEvent({
      name: 'ToolExecuted',
      correlationId,
      userId: 'u1',
      properties: {
        toolName: 'github_list_issues',
        success: true,
        executionKind: 'instrumental-direct-dispatch',
        returnsControlTo: 'conscious-thread',
      },
    });

    const trace = getTraceTree(correlationId);
    const spawnPhase = trace?.phases.find((phase) => phase.name === 'SubAgentSpawned');
    const toolPhase = trace?.phases.find((phase) => phase.name === 'ToolExecuted');

    expect(spawnPhase?.detail).toContain('executionKind: instrumental-sub-session');
    expect(spawnPhase?.detail).toContain('returnsControlTo: conscious-thread');
    expect(spawnPhase?.detail).toContain('contextBoundary: minimal-scoped-context');
    expect(toolPhase?.detail).toContain('executionKind: instrumental-direct-dispatch');
    expect(toolPhase?.detail).toContain('returnsControlTo: conscious-thread');
  });

  it('records limbic ingress source and decision details for compatibility-mode proof', () => {
    const compatDecision = evaluateLimbicIngress({
      source: 'teams-message',
      userId: 'u1',
      correlationId: 'corr-499-compat',
      compatibilityMode: true,
      hasActiveSession: false,
    });
    expect(compatDecision.decision).toBe('steer');
    expect(compatDecision.reason).toContain('Compatibility mode');

    const queuedDecision = evaluateLimbicIngress({
      source: 'teams-message',
      userId: 'u1',
      correlationId: 'corr-499-queue',
      compatibilityMode: false,
      hasActiveSession: true,
    });
    expect(queuedDecision.decision).toBe('queue');
    expect(queuedDecision.reason).toContain('Single-session enforcement');

    const correlationId = 'corr-499-trace';
    recordLimbicIngressDecision({
      source: 'pending-intent-replay',
      userId: 'u1',
      correlationId,
      compatibilityMode: true,
      hasActiveSession: false,
    });

    const trace = getTraceTree(correlationId);
    const limbicPhase = trace?.phases.find((phase) => phase.name === 'LimbicDecision');
    const overridePhase = trace?.phases.find((phase) => phase.name === 'PolicyOverrideApplied');

    expect(limbicPhase?.detail).toContain('source: pending-intent-replay');
    expect(limbicPhase?.detail).toContain('decision: steer');
    expect(overridePhase?.detail).toContain('authority: living-mind-compatibility-mode');
  });

  it('records defer decisions when conscious-lane impairment blocks heavier work', () => {
    const deferDecision = evaluateLimbicIngress({
      source: 'teams-message',
      userId: 'u1',
      correlationId: 'corr-529-defer',
      compatibilityMode: false,
      hasActiveSession: false,
      consciousModelImpaired: true,
      requestedTaskComplexity: 'compound',
    });
    expect(deferDecision.decision).toBe('defer');
    expect(deferDecision.reason).toContain('defer compound work');

    const correlationId = 'corr-529-defer-trace';
    recordLimbicIngressDecision({
      source: 'teams-message',
      userId: 'u1',
      correlationId,
      compatibilityMode: false,
      hasActiveSession: false,
      consciousModelImpaired: true,
      requestedTaskComplexity: 'complex',
    });

    const trace = getTraceTree(correlationId);
    const limbicPhase = trace?.phases.find((phase) => phase.name === 'LimbicDecision');
    const overridePhase = trace?.phases.find((phase) => phase.name === 'PolicyOverrideApplied');

    expect(limbicPhase?.detail).toContain('decision: defer');
    expect(overridePhase?.detail).toContain('authority: living-mind-impairment-protocol');
  });

  it('records interruption-depth queue decisions in the runtime trace detail', () => {
    const queuedDecision = evaluateLimbicIngress({
      source: 'teams-message',
      userId: 'u1',
      correlationId: 'corr-511-queue',
      compatibilityMode: true,
      hasActiveSession: true,
      interruptionDepth: MAX_INTERRUPTION_DEPTH,
    });
    expect(queuedDecision.decision).toBe('queue');
    expect(queuedDecision.reason).toContain('depth cap');

    const correlationId = 'corr-511-trace';
    recordLimbicIngressDecision({
      source: 'teams-message',
      userId: 'u1',
      correlationId,
      compatibilityMode: true,
      hasActiveSession: true,
      interruptionDepth: MAX_INTERRUPTION_DEPTH,
    });

    const trace = getTraceTree(correlationId);
    const limbicPhase = trace?.phases.find((phase) => phase.name === 'LimbicDecision');
    expect(limbicPhase?.detail).toContain('decision: queue');
    expect(limbicPhase?.detail).toContain(`interruptionDepth: ${MAX_INTERRUPTION_DEPTH}`);
  });

  it('queues active-session overlap before compatibility-mode steer can take effect', () => {
    const queuedDecision = evaluateLimbicIngress({
      source: 'teams-message',
      userId: 'u1',
      correlationId: 'corr-517-queue',
      compatibilityMode: true,
      hasActiveSession: true,
      interruptionDepth: 0,
    });
    expect(queuedDecision.decision).toBe('queue');
    expect(queuedDecision.reason).toContain('Single-session enforcement');

    const correlationId = 'corr-517-trace';
    recordLimbicIngressDecision({
      source: 'teams-message',
      userId: 'u1',
      correlationId,
      compatibilityMode: true,
      hasActiveSession: true,
      interruptionDepth: 0,
    });

    const trace = getTraceTree(correlationId);
    const limbicPhase = trace?.phases.find((phase) => phase.name === 'LimbicDecision');
    const overridePhase = trace?.phases.find((phase) => phase.name === 'PolicyOverrideApplied');
    expect(limbicPhase?.detail).toContain('decision: queue');
    expect(limbicPhase?.detail).toContain('Single-session enforcement');
    expect(overridePhase).toBeUndefined();
  });

  it('records live external-event routing outcomes in the runtime trace detail', () => {
    const correlationId = 'corr-500-proof-surface';

    trackEvent({
      name: 'DevLoopRelayPush',
      correlationId,
      userId: 'u1',
      properties: {
        messageType: 'DEVLOOP',
        deliveredToOverseer: true,
        instanceId: 'overseer-u1-abc123',
      },
    });

    const trace = getTraceTree(correlationId);
    const phase = trace?.phases.find((p) => p.name === 'DevLoopRelayPush');
    expect(phase?.detail).toContain('deliveredToOverseer: true');
    expect(phase?.detail).toContain('instanceId: overseer-u1-abc123');
  });

  it('records interruption breadcrumb proof details in the runtime trace', () => {
    const correlationId = 'corr-509-proof';

    trackEvent({
      name: 'InterruptionBreadcrumbWritten',
      correlationId,
      userId: 'u1',
      properties: {
        interruptedInstanceId: 'overseer-u1-old',
        interruptedCorrelationId: 'corr-old',
        interruptedSource: 'teams-message',
        type: 'interruption-breadcrumb',
      },
    });

    trackEvent({
      name: 'InterruptionBreadcrumbRead',
      correlationId,
      userId: 'u1',
      properties: {
        found: true,
        interruptedInstanceId: 'overseer-u1-old',
      },
    });

    const trace = getTraceTree(correlationId);
    const writtenPhase = trace?.phases.find((p) => p.name === 'InterruptionBreadcrumbWritten');
    const readPhase = trace?.phases.find((p) => p.name === 'InterruptionBreadcrumbRead');
    expect(writtenPhase?.detail).toContain('interruptedInstanceId: overseer-u1-old');
    expect(readPhase?.detail).toContain('found: true');
  });

  it('records pending-intent queue reasons in the runtime trace', () => {
    const correlationId = 'corr-510-proof';

    trackEvent({
      name: 'PendingIntentCreated',
      correlationId,
      userId: 'u1',
      properties: {
        trackingId: 'PI-TEST123',
        creationReason: 'overseer-unreachable',
        failureReason: 'durable start failed',
      },
    });

    const trace = getTraceTree(correlationId);
    const phase = trace?.phases.find((p) => p.name === 'PendingIntentCreated');
    expect(phase?.detail).toContain('trackingId: PI-TEST123');
    expect(phase?.detail).toContain('failureReason: durable start failed');
  });

  it('records chrono self-awaken registration and trigger details in the runtime trace', () => {
    const correlationId = 'corr-514-proof';

    trackEvent({
      name: 'ChronoScheduledWakeRegistered',
      correlationId,
      userId: 'u1',
      properties: {
        wakeId: 'u1:wake:test',
        wakeAt: '2026-04-03T12:00:00.000Z',
      },
    });

    trackEvent({
      name: 'ChronoScheduledWakeTriggered',
      correlationId,
      userId: 'u1',
      properties: {
        wakeId: 'u1:wake:test',
        wakeAt: '2026-04-03T12:00:00.000Z',
        instanceId: 'overseer-u1-wake-test',
      },
    });

    const trace = getTraceTree(correlationId);
    const registeredPhase = trace?.phases.find((p) => p.name === 'ChronoScheduledWakeRegistered');
    const triggeredPhase = trace?.phases.find((p) => p.name === 'ChronoScheduledWakeTriggered');
    expect(registeredPhase?.detail).toContain('wakeId: u1:wake:test');
    expect(triggeredPhase?.detail).toContain('instanceId: overseer-u1-wake-test');
  });

  it('records paused-task paging and resume details in the runtime trace', () => {
    const correlationId = 'corr-515-proof';

    trackEvent({
      name: 'PausedTaskPaged',
      correlationId,
      userId: 'u1',
      properties: {
        pausedTaskId: 'u1:paused-task',
        interruptedInstanceId: 'overseer-u1-old',
        interruptedCorrelationId: 'corr-old',
      },
    });

    trackEvent({
      name: 'PausedTaskResumeInjected',
      correlationId,
      userId: 'u1',
      properties: {
        pausedTaskId: 'u1:paused-task',
        interruptedInstanceId: 'overseer-u1-old',
        found: true,
      },
    });

    trackEvent({
      name: 'SteeringInjectionApplied',
      correlationId,
      userId: 'u1',
      properties: {
        applied: true,
        reason: 'resume marker injected',
        hasPausedTask: true,
      },
    });

    const trace = getTraceTree(correlationId);
    const pagedPhase = trace?.phases.find((p) => p.name === 'PausedTaskPaged');
    const resumedPhase = trace?.phases.find((p) => p.name === 'PausedTaskResumeInjected');
    const steeringPhase = trace?.phases.find((p) => p.name === 'SteeringInjectionApplied');
    expect(pagedPhase?.detail).toContain('pausedTaskId: u1:paused-task');
    expect(resumedPhase?.detail).toContain('found: true');
    expect(steeringPhase?.detail).toContain('hasPausedTask: true');
  });

  it('records living-session ingress-window and drained-message details in the runtime trace', () => {
    const correlationId = 'corr-521-proof';

    trackEvent({
      name: 'LivingSessionIngressWindowOpened',
      correlationId,
      userId: 'u1',
      properties: {
        instanceId: 'overseer-u1-live',
      },
    });

    trackEvent({
      name: 'LivingSessionNewMessageDrained',
      correlationId,
      userId: 'u1',
      properties: {
        instanceId: 'overseer-u1-live',
        previousCorrelationId: 'corr-old',
      },
    });

    const trace = getTraceTree(correlationId);
    const openedPhase = trace?.phases.find((p) => p.name === 'LivingSessionIngressWindowOpened');
    const drainedPhase = trace?.phases.find((p) => p.name === 'LivingSessionNewMessageDrained');
    expect(openedPhase?.detail).toContain('instanceId: overseer-u1-live');
    expect(drainedPhase?.detail).toContain('previousCorrelationId: corr-old');
  });
});