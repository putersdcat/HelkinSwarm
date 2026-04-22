import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #707 internal deadline wiring. Verifies that the
// sessionOrchestrator forwards `parentBudgetMs` to the swarm sub-orchestrator
// and that the sub-orchestrator self-aborts before the parent's outer
// `swarmTimer` can preempt it (the silent-orphan race documented in #706 /
// #707). These are textual assertions on the source so a future refactor
// cannot silently delete the deadline plumbing without breaking this test.

const sessionSource = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'sessionOrchestrator.ts'),
  'utf-8',
);

const swarmSource = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmOrchestrator.ts'),
  'utf-8',
);

const typesSource = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmTypes.ts'),
  'utf-8',
);

describe('swarm internal deadline (#707)', () => {
  it('declares parentBudgetMs on SwarmOrchestratorInput', () => {
    expect(typesSource).toMatch(/parentBudgetMs\?:\s*number/);
  });

  it('sessionOrchestrator forwards swarmOuterTimeoutMs as parentBudgetMs', () => {
    // swarmOuterTimeoutMs must be computed before swarmInput so it can be
    // passed in. The literal field assignment must appear in swarmInput.
    const outerIdx = sessionSource.indexOf('const swarmOuterTimeoutMs = Math.max(');
    const inputIdx = sessionSource.indexOf('const swarmInput: SwarmOrchestratorInput');
    expect(outerIdx).toBeGreaterThan(-1);
    expect(inputIdx).toBeGreaterThan(-1);
    expect(outerIdx).toBeLessThan(inputIdx);
    expect(sessionSource).toContain('parentBudgetMs: swarmOuterTimeoutMs');
  });

  it('swarmOrchestrator destructures parentBudgetMs from input', () => {
    expect(swarmSource).toMatch(
      /const\s*\{\s*plan,\s*correlationId,\s*userId,\s*userMessage,\s*parentBudgetMs\s*\}\s*=\s*input/,
    );
  });

  it('swarmOrchestrator arms an internal deadline using grace shorter than parent budget', () => {
    expect(swarmSource).toContain('SWARM_INTERNAL_DEADLINE_GRACE_MS');
    expect(swarmSource).toMatch(/internalDeadlineUtcMs\s*=/);
    // Deadline must be parentBudget MINUS grace, not greater than parent budget.
    expect(swarmSource).toContain('parentBudgetMs - SWARM_INTERNAL_DEADLINE_GRACE_MS');
  });

  it('swarmOrchestrator returns a graceful partial result when deadline is exceeded', () => {
    expect(swarmSource).toContain('swarm-internal-deadline');
    expect(swarmSource).toContain("'Internal deadline exceeded before leader synthesis (#707)'");
    expect(swarmSource).toMatch(
      /if\s*\(\s*context\.df\.currentUtcDateTime\.getTime\(\)\s*>=\s*internalDeadlineUtcMs\s*\)/,
    );
  });

  it('legacy callers without parentBudgetMs disable the deadline (Infinity sentinel)', () => {
    expect(swarmSource).toContain('Number.POSITIVE_INFINITY');
  });
});
