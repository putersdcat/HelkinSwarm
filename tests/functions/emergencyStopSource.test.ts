import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('emergency stop residue cleanup source guards', () => {
  it('clears stage-health residue after terminating live orchestrations', () => {
    const httpSource = readFileSync('src/functions/emergencyStop.ts', 'utf8');
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const cleanupSource = readFileSync('src/functions/staleSessionCleanupTimer.ts', 'utf8');

    expect(httpSource).toContain('clearOrchestratorStagesForInstanceIds');
    expect(httpSource).toContain('targets.map((status) => status.instanceId)');

    expect(botSource).toContain('clearOrchestratorStagesForInstanceIds');
    expect(botSource).toContain('terminationTargets.map((status) => status.instanceId)');

    expect(cleanupSource).toContain('clearOrchestratorStagesForInstanceIds');
    expect(cleanupSource).toContain('terminatedInstanceIds.push(candidate.instanceId)');
  });
});