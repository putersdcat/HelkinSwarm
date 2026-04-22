// Source-pin test for SESSION_TIMEOUT_MS in overseer.ts (#714)
//
// Background: the overseer guards every per-turn sub-orchestrator with
// `SESSION_TIMEOUT_MS`. If this cap is shorter than the longest legitimate
// sub-orchestrator turn, the overseer terminates the session mid-flight and
// post-turn finalizers (e.g. `persistSwarmResultActivity` for swarms) never
// run. The Cosmos doc is then stuck `status='running'` until the
// `staleSwarmRunningTimer` reaper (#693) reconciles it ~22min later — exactly
// the fingerprint of every recent swarm fail (durMs=0, tokens≈5000, empty
// workers, "Reconciled by staleSwarmRunningTimer" warning).
//
// Specifically:
//   - sessionOrchestrator's `swarmOuterTimeoutMs = max(plan.timeoutMs * 6, 720_000)`
//     pinned a hard floor of 720s (12min) for swarm sub-orchestrators (#688).
//   - The overseer cap MUST exceed that floor + buffer for swarm-ack reply,
//     leader synthesis, persistSwarmResultActivity, and the final user reply.
//
// This test fails the build if anyone reduces SESSION_TIMEOUT_MS below the
// swarm floor + the minimum buffer agreed in #714.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const overseerPath = resolve(__dirname, '../../src/orchestrator/overseer.ts');
const sessionOrchestratorPath = resolve(
  __dirname,
  '../../src/orchestrator/sessionOrchestrator.ts',
);

describe('overseer SESSION_TIMEOUT_MS source-pin (#714)', () => {
  it('uses the documented 16-minute cap', () => {
    const src = readFileSync(overseerPath, 'utf8');
    expect(src).toContain('SESSION_TIMEOUT_MS = 16 * 60 * 1000');
  });

  it('exceeds sessionOrchestrator swarmOuterTimeoutMs floor by at least 4 minutes', () => {
    // Source-pin the swarm budget floor too, so a future swarm-budget bump
    // forces a re-evaluation of the overseer cap rather than silently
    // re-introducing the #714 hang.
    const sessSrc = readFileSync(sessionOrchestratorPath, 'utf8');
    expect(sessSrc).toContain('Math.max(swarmDecomposerResult.plan.timeoutMs * 6, 720_000)');

    const SWARM_FLOOR_MS = 720_000; // 12 minutes
    const REQUIRED_BUFFER_MS = 4 * 60 * 1000; // 4 minutes for ack/synth/persist/reply
    const SESSION_TIMEOUT_MS = 16 * 60 * 1000;
    expect(SESSION_TIMEOUT_MS).toBeGreaterThanOrEqual(SWARM_FLOOR_MS + REQUIRED_BUFFER_MS);
  });
});
