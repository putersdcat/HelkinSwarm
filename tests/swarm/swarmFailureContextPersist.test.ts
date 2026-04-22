import { describe, expect, it } from 'vitest';

// Mock Cosmos + telemetry so the persistence module loads without env.
import { vi } from 'vitest';
vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: () => ({ items: { upsert: vi.fn().mockResolvedValue({}) } }),
}));
vi.mock('../../src/observability/telemetry.js', () => ({ trackEvent: vi.fn() }));
vi.mock('../../src/observability/orchestratorStageHealth.js', () => ({
  recordOrchestratorStage: vi.fn().mockResolvedValue(undefined),
}));

import { buildSwarmExecutionDocument } from '../../src/orchestrator/swarm/persistSwarmResultActivity.js';
import type { PersistSwarmResultInput } from '../../src/orchestrator/swarm/persistSwarmResultActivity.js';
import type { SwarmOrchestratorResult } from '../../src/orchestrator/swarm/swarmTypes.js';

// [#710 Gap 1] Behavioral test for failure-context persistence.
// The Swarm tab cannot render a failure-summary card if leaderError is dropped
// on the way to Cosmos. This test verifies the round-trip from
// SwarmOrchestratorResult.leaderResult.error → SwarmExecutionDocument.leaderError.

function makeFailedResult(): SwarmOrchestratorResult {
  return {
    response: '',
    success: false,
    totalTokensUsed: 1234,
    swarmId: 'swarm-fail-test',
    agentResults: [
      {
        agentName: 'Benjamin',
        success: false,
        roundsUsed: 1,
        tokensUsed: 200,
        toolCallsMade: 0,
        chatroomMessagesSent: 0,
        toolsUsed: [],
        durationMs: 240_000,
        model: 'x-ai/grok-4-1-fast',
        error: 'Worker timed out after 240000ms',
        retryAttempts: 1,
        fatal: true,
      },
    ],
    leaderResult: {
      synthesis: '',
      success: false,
      tokensUsed: 0,
      roundsUsed: 0,
      agentsHeardFrom: [],
      model: 'swarm-fatal',
      error: 'Benjamin fatally failed after 1 retry',
    },
    chatroomTranscript: [],
    swarmCost: {
      decomposerTokens: 0,
      workerTokens: 200,
      leaderTokens: 0,
      totalTokens: 200,
      agentBreakdown: [],
    },
  };
}

describe('Gap 1 — failure-context persistence (#710)', () => {
  it('persists leaderResult.error as leaderError on the swarm-execution document', () => {
    const input: PersistSwarmResultInput = {
      userId: 'test-user',
      correlationId: 'corr-fail',
      swarmId: 'swarm-fail-test',
      userQuery: 'Probe a known-failing scenario',
      decomposerTokens: 100,
      decomposerModel: 'grok-4-1-fast',
      executionDurationMs: 250_000,
      result: makeFailedResult(),
    };

    const doc = buildSwarmExecutionDocument(input);

    expect(doc.leaderError).toBe('Benjamin fatally failed after 1 retry');
    expect(doc.status).toBe('fail');
    expect(doc.success).toBe(false);
  });

  it('persists per-agent error, retryAttempts, and fatal flag on agentResults', () => {
    const input: PersistSwarmResultInput = {
      userId: 'test-user',
      correlationId: 'corr-fail',
      swarmId: 'swarm-fail-test',
      userQuery: 'Probe',
      decomposerTokens: 0,
      decomposerModel: 'grok-4-1-fast',
      executionDurationMs: 250_000,
      result: makeFailedResult(),
    };

    const doc = buildSwarmExecutionDocument(input);

    expect(doc.agentResults).toHaveLength(1);
    expect(doc.agentResults[0]?.error).toBe('Worker timed out after 240000ms');
    expect(doc.agentResults[0]?.retryAttempts).toBe(1);
    expect(doc.agentResults[0]?.fatal).toBe(true);
  });

  it('omits leaderError when the leader did not error (no noise on healthy swarms)', () => {
    const healthy: SwarmOrchestratorResult = {
      ...makeFailedResult(),
      success: true,
      response: 'Healthy synthesis.',
      leaderResult: {
        synthesis: 'Healthy synthesis.',
        success: true,
        tokensUsed: 500,
        roundsUsed: 1,
        agentsHeardFrom: ['Benjamin'],
        model: 'x-ai/grok-4-1-fast',
        // no error
      },
    };
    const input: PersistSwarmResultInput = {
      userId: 'test-user',
      correlationId: 'corr-ok',
      swarmId: 'swarm-ok-test',
      userQuery: 'Probe',
      decomposerTokens: 0,
      decomposerModel: 'grok-4-1-fast',
      executionDurationMs: 12_000,
      result: healthy,
    };

    const doc = buildSwarmExecutionDocument(input);
    expect(doc.leaderError).toBeUndefined();
  });

  it('truncates an enormous leaderError so it cannot blow the 1.9 MB doc-size budget', () => {
    const monster = 'x'.repeat(50_000);
    const result = makeFailedResult();
    result.leaderResult.error = monster;
    const input: PersistSwarmResultInput = {
      userId: 'test-user',
      correlationId: 'corr-fail-huge',
      swarmId: 'swarm-fail-huge',
      userQuery: 'Probe',
      decomposerTokens: 0,
      decomposerModel: 'grok-4-1-fast',
      executionDurationMs: 250_000,
      result,
    };

    const doc = buildSwarmExecutionDocument(input);
    // MAX_AGENT_ERROR_CHARS in persistSwarmResultActivity.ts is 300.
    expect(doc.leaderError).toBeDefined();
    expect((doc.leaderError ?? '').length).toBeLessThanOrEqual(300);
  });
});
