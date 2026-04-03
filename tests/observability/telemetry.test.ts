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

  it('records limbic ingress source and decision details for compatibility-mode proof', () => {
    const compatDecision = evaluateLimbicIngress({
      source: 'teams-message',
      userId: 'u1',
      correlationId: 'corr-499-compat',
      compatibilityMode: true,
      hasActiveSession: false,
    });
    expect(compatDecision.decision).toBe('compat-start');
    expect(compatDecision.reason).toContain('Compatibility mode');

    const queuedDecision = evaluateLimbicIngress({
      source: 'teams-message',
      userId: 'u1',
      correlationId: 'corr-499-queue',
      compatibilityMode: false,
      hasActiveSession: true,
    });
    expect(queuedDecision.decision).toBe('queue');
    expect(queuedDecision.reason).toContain('active session');

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
    expect(limbicPhase?.detail).toContain('decision: compat-start');
    expect(overridePhase?.detail).toContain('authority: living-mind-compatibility-mode');
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
});