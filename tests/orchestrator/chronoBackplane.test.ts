import { describe, expect, it } from 'vitest';
import {
  buildChronoContinuityDocument,
  buildChronoInterruptionBreadcrumb,
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
});