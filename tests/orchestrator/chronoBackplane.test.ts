import { describe, expect, it } from 'vitest';
import { buildChronoContinuityDocument } from '../../src/orchestrator/chronoBackplane.js';

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
});