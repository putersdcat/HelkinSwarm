import { describe, expect, it } from 'vitest';
import {
  buildChronoContinuityDocument,
  buildChronoInterruptionBreadcrumb,
  buildChronoPausedTask,
  buildChronoScheduledWake,
} from '../../src/orchestrator/chronoBackplane.js';

describe('chrono backplane compatibility seam', () => {
  it('builds a continuity intention document from a turn', () => {
    const doc = buildChronoContinuityDocument({
      userId: 'u1',
      correlationId: 'corr-chrono-1',
      userMessage: 'Please continue the chrono backplane migration work next.',
      assistantReply: 'I will keep the migration thread in mind.',
    });

    expect(doc.id).toBe('u1:continuity');
    expect(doc.type).toBe('continuity-intention');
    expect(doc.intention).toContain('chrono backplane migration');
    expect(doc.anchorCorrelationId).toBe('corr-chrono-1');
  });

  it('builds an interruption breadcrumb document for overlapping turns', () => {
    const doc = buildChronoInterruptionBreadcrumb({
      userId: 'u1',
      interruptedInstanceId: 'overseer-u1-old',
      interruptedCorrelationId: 'corr-old',
      interruptedSource: 'teams-message',
      interruptedByCorrelationId: 'corr-new',
      interruptedByMessage: 'Actually, switch to the urgent task.',
    });

    expect(doc.id).toBe('u1:interruption');
    expect(doc.type).toBe('interruption-breadcrumb');
    expect(doc.interruptedInstanceId).toBe('overseer-u1-old');
    expect(doc.interruptedByCorrelationId).toBe('corr-new');
  });

  it('builds a scheduled wake document for chrono-backed self-awaken registration', () => {
    const doc = buildChronoScheduledWake({
      userId: 'u1',
      wakeAt: '2026-04-03T12:00:00.000Z',
      wakeMessage: 'Reply with exactly: self awaken proof.',
      registrationCorrelationId: 'corr-wake-register',
      conversationReferenceJson: '{"conversation":{"id":"conv-1"}}',
    });

    expect(doc.id).toContain('u1:wake:');
    expect(doc.type).toBe('scheduled-wake');
    expect(doc.status).toBe('scheduled');
    expect(doc.wakeAt).toBe('2026-04-03T12:00:00.000Z');
    expect(doc.wakeMessage).toContain('self awaken proof');
  });

  it('builds a paused-task document for interruption paging', () => {
    const doc = buildChronoPausedTask({
      userId: 'u1',
      interruptedInstanceId: 'overseer-u1-old',
      interruptedCorrelationId: 'corr-old',
      interruptedSource: 'teams-message',
      pausedByCorrelationId: 'corr-new',
      pausedByMessage: 'Actually switch to the urgent thread.',
    });

    expect(doc.id).toBe('u1:paused-task');
    expect(doc.type).toBe('paused-task');
    expect(doc.status).toBe('paused');
    expect(doc.interruptedInstanceId).toBe('overseer-u1-old');
    expect(doc.resumePrompt).toContain('corr-old');
  });
});