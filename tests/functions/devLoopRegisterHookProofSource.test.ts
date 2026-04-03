import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop synthetic hook proof surface', () => {
  it('exposes an owner-only helper that registers a short-lived synthetic webhook hook for live proof', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("route: 'devloop/register-hook-proof'");
    expect(source).toContain('const RegisterHookProofPayloadSchema = z.object({');
    expect(source).toContain('const correlationId = `register-hook-proof-${Date.now()}`;');
    expect(source).toContain('const registered = await registerHook({');
    expect(source).toContain("skillDomain: 'devloop-proof'");
    expect(source).toContain("hookType: 'synthetic-webhook-proof'");
    expect(source).toContain("name: 'DurableHookRegistered'");
    expect(source).toContain("endpoint: 'register-hook-proof'");
    expect(source).toContain('firePayloadTemplate: {');
  });
});