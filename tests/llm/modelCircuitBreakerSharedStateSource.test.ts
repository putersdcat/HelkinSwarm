import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('model circuit breaker shared-state source guards', () => {
  it('mirrors degraded model state to shared storage and refreshes it before live chat completion routing', () => {
    const circuitBreakerSource = readFileSync('src/llm/modelCircuitBreaker.ts', 'utf8');
    const foundrySource = readFileSync('src/llm/foundryClient.ts', 'utf8');
    const devLoopRelaySource = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(circuitBreakerSource).toContain('export async function persistSharedDegradedModels(): Promise<void> {');
    expect(circuitBreakerSource).toContain('export async function syncSharedDegradedModels(force = false): Promise<void> {');
    expect(circuitBreakerSource).toContain('void persistSharedDegradedModels();');
    expect(foundrySource).toContain('await syncSharedDegradedModels();');
    expect(devLoopRelaySource).toContain('await persistSharedDegradedModels();');
  });
});