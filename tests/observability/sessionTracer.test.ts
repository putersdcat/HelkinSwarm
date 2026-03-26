import { describe, expect, it } from 'vitest';
import {
  findTraceTreeByShortCorrelation,
  getTraceTree,
  recordTracePhase,
} from '../../src/observability/sessionTracer.js';

describe('sessionTracer short correlation lookup', () => {
  it('resolves a short corr footer token to the most recent full trace id', () => {
    const correlationId = 'f4f9fd48-1111-2222-3333-444444444444';

    recordTracePhase({
      correlationId,
      userId: 'u1',
      phaseId: 'phase-1',
      name: 'ReplySent',
      type: 'reply-send',
      durationMs: 25,
      status: 'completed',
    });

    expect(getTraceTree(correlationId)?.correlationId).toBe(correlationId);
    expect(findTraceTreeByShortCorrelation('f4f9fd48')?.correlationId).toBe(correlationId);
    expect(findTraceTreeByShortCorrelation('corr:f4f9fd48')?.correlationId).toBe(correlationId);
    expect(findTraceTreeByShortCorrelation('[corr:f4f9fd48]')?.correlationId).toBe(correlationId);
  });
});