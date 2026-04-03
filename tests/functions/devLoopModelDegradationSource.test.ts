import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop model degradation proof surface', () => {
  it('exposes an owner-only helper that can seed and clear temporary in-memory model degradation', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("route: 'devloop/model-degradation'");
    expect(source).toContain('const ModelDegradationProofPayloadSchema = z.discriminatedUnion');
    expect(source).toContain("action: z.literal('seed')");
    expect(source).toContain("action: z.literal('clear')");
    expect(source).toContain('markModelDegraded(deploymentName, body.reason, body.cooldownSeconds * 1000);');
    expect(source).toContain('reportLlmFailure(deploymentName);');
    expect(source).toContain('clearModelDegraded(deploymentName);');
    expect(source).toContain('reportLlmSuccess(deploymentName);');
    expect(source).toContain("endpoint: 'model-degradation'");
  });
});