import { describe, expect, it } from 'vitest';
import { trackEvent } from '../../src/observability/telemetry.js';
import { getTraceTree } from '../../src/observability/sessionTracer.js';

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
});