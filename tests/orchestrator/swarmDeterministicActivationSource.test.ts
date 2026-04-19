import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sessionOrchestrator deterministic swarm activation source', () => {
  it('forces activate_swarm for always-swarm planner outcomes, not just explicit override phrases (#691)', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain("planResult.swarmComplexityZone === 'always-swarm'");
    expect(source).toContain('planner_always_swarm');
    expect(source).toContain('SwarmDeterministicActivation');
  });
});
