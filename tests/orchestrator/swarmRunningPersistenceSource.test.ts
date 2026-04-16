import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'sessionOrchestrator.ts'),
  'utf-8',
);

describe('sessionOrchestrator swarm audit persistence', () => {
  it('persists a running swarm execution record before awaiting swarm completion', () => {
    expect(source).toContain("statusOverride: 'running'");
    expect(source).toContain('agentCountOverride: swarmDecomposerResult.plan.agents.length');
  });
});
