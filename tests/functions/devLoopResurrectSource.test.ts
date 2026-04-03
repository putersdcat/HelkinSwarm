import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop resurrect ingress proof surface', () => {
  it('routes owner-only resurrect starts through limbic ingress and mind-session acquisition', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("route: 'devloop/resurrect'");
    expect(source).toContain("const resurrectCorrelationId = `resurrect-${targetUserId}-${Date.now()}`;");
    expect(source).toContain('recordLimbicIngressDecision({');
    expect(source).toContain("source: 'devloop-relay'");
    expect(source).toContain('compatibilityMode: getEnvConfig().livingMindCompatibilityMode');
    expect(source).toContain('correlationId: resurrectCorrelationId,');
    expect(source).toContain('await client.startNew(\'overseer\', { instanceId: startInstanceId, input: event });');
    expect(source).toContain('await signalMindSessionAcquire(client, targetUserId, {');
    expect(source).toContain("authority: body.initialMessage ? 'mind-session-guard-acquire' : 'none'");
    expect(source).toContain("source: 'devloop-relay'");
    expect(source).toContain('instanceId: startInstanceId,');
    expect(source).toContain('correlationId: body.initialMessage ? resurrectCorrelationId : null,');
  });
});