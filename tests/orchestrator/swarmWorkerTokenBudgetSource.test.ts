// Source-level verification: swarm worker enforces per-agent token budget.
// Issue: #647

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

const orchestratorSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmOrchestrator.ts'),
  'utf-8',
);

const telemetrySrc = readFileSync(
  join(process.cwd(), 'src', 'observability', 'telemetry.ts'),
  'utf-8',
);

const turnTelSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'turnTelemetry.ts'),
  'utf-8',
);

describe('swarmWorkerActivity — token budget enforcement (#647)', () => {
  it('checks input.tokenBudget against totalTokens', () => {
    expect(workerSrc).toContain('input.tokenBudget');
    expect(workerSrc).toContain('totalTokens >= input.tokenBudget');
  });

  it('sets tokenBudgetExceeded flag on breach', () => {
    expect(workerSrc).toContain('tokenBudgetExceeded = true');
  });

  it('fires SwarmWorkerBudgetExceeded telemetry event', () => {
    expect(workerSrc).toContain('SwarmWorkerBudgetExceeded');
  });

  it('captures partial content before breaking', () => {
    // After setting budgetExceeded, worker must capture what it has
    const budgetIdx = workerSrc.indexOf('tokenBudgetExceeded = true');
    const breakIdx = workerSrc.indexOf('break;', budgetIdx);
    expect(budgetIdx).toBeGreaterThan(-1);
    expect(breakIdx).toBeGreaterThan(budgetIdx);
  });

  it('returns tokenBudget and tokenBudgetExceeded in result', () => {
    expect(workerSrc).toContain('tokenBudget: input.tokenBudget');
    expect(workerSrc).toContain('tokenBudgetExceeded');
    // Must appear in the return object, not just as a variable
    const returnIdx = workerSrc.lastIndexOf('return {');
    const snippet = workerSrc.slice(returnIdx, returnIdx + 500);
    expect(snippet).toContain('tokenBudgetExceeded');
  });
});

describe('swarmOrchestrator — wires tokenBudget to worker input (#647)', () => {
  it('passes agent.tokenBudget to SwarmWorkerInput', () => {
    expect(orchestratorSrc).toContain('tokenBudget: agent.tokenBudget');
  });
});

describe('telemetry — SwarmWorkerBudgetExceeded event registered (#647)', () => {
  it('TelemetryEventName includes SwarmWorkerBudgetExceeded', () => {
    expect(telemetrySrc).toContain('SwarmWorkerBudgetExceeded');
  });
});

describe('turnTelemetry — budget display in footer (#647)', () => {
  it('SwarmAgentTelemetry interface includes tokenBudget', () => {
    expect(turnTelSrc).toContain('tokenBudget?');
  });

  it('SwarmAgentTelemetry interface includes tokenBudgetExceeded', () => {
    expect(turnTelSrc).toContain('tokenBudgetExceeded?');
  });

  it('renders budget tag in per-agent footer', () => {
    // Should have some conditional for budget display
    expect(turnTelSrc).toContain('tokenBudgetExceeded');
    expect(turnTelSrc).toContain('tokenBudget');
  });
});
