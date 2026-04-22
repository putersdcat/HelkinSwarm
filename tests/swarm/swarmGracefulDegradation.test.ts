import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: () => ({ items: { upsert: vi.fn().mockResolvedValue({}) } }),
}));
vi.mock('../../src/observability/telemetry.js', () => ({ trackEvent: vi.fn() }));
vi.mock('../../src/observability/orchestratorStageHealth.js', () => ({
  recordOrchestratorStage: vi.fn().mockResolvedValue(undefined),
}));

import { buildSwarmExecutionDocument } from '../../src/orchestrator/swarm/persistSwarmResultActivity.js';
import type { PersistSwarmResultInput } from '../../src/orchestrator/swarm/persistSwarmResultActivity.js';
import type { SwarmOrchestratorResult, SwarmWorkerResult } from '../../src/orchestrator/swarm/swarmTypes.js';

// [#710 Gap 2 + Gap 4] Behavioral test for graceful degradation.
// Verifies: best-effort fan-in produces a usable swarm result when SOME
// workers fail; the failedAgents list is persisted; and the status is
// computed as 'partial' (not 'ok') when there is a survivor + a casualty.

function worker(name: string, success: boolean, error?: string): SwarmWorkerResult {
  return {
    agentName: name,
    success,
    roundsUsed: success ? 3 : 1,
    tokensUsed: success ? 1500 : 200,
    toolCallsMade: success ? 5 : 0,
    chatroomMessagesSent: success ? 2 : 0,
    toolsUsed: success ? ['web_fetch_page'] : [],
    durationMs: success ? 30_000 : 240_000,
    model: 'x-ai/grok-4-1-fast',
    ...(error ? { error, retryAttempts: 1, fatal: true } : {}),
  };
}

function input(result: SwarmOrchestratorResult): PersistSwarmResultInput {
  return {
    userId: 'test-user',
    correlationId: 'corr-gap2',
    swarmId: result.swarmId,
    userQuery: 'Probe',
    decomposerTokens: 100,
    decomposerModel: 'grok-4-1-fast',
    executionDurationMs: 60_000,
    result,
  };
}

describe('Gap 2 + Gap 4 — graceful degradation + honest status (#710)', () => {
  it("status is 'partial' when leader OK but at least one worker failed", () => {
    const result: SwarmOrchestratorResult = {
      response: 'Synthesis with one gap.',
      success: true,
      totalTokensUsed: 3500,
      swarmId: 'swarm-partial-1',
      agentResults: [
        worker('Benjamin', true),
        worker('Harper', false, 'Worker timed out after 240000ms'),
        worker('Lucas', true),
      ],
      leaderResult: {
        synthesis: 'Synthesis with one gap.',
        success: true,
        tokensUsed: 500,
        roundsUsed: 1,
        agentsHeardFrom: ['Benjamin', 'Lucas'],
        model: 'x-ai/grok-4-1-fast',
      },
      chatroomTranscript: [],
      failedAgents: ['Harper'],
    };

    const doc = buildSwarmExecutionDocument(input(result));
    expect(doc.status).toBe('partial');
    expect(doc.success).toBe(true);
    expect(doc.failedAgents).toEqual(['Harper']);
  });

  it("status is 'ok' when leader OK AND every worker OK (no gaps)", () => {
    const result: SwarmOrchestratorResult = {
      response: 'Clean synthesis.',
      success: true,
      totalTokensUsed: 4500,
      swarmId: 'swarm-ok-1',
      agentResults: [worker('Benjamin', true), worker('Harper', true), worker('Lucas', true)],
      leaderResult: {
        synthesis: 'Clean synthesis.',
        success: true,
        tokensUsed: 500,
        roundsUsed: 1,
        agentsHeardFrom: ['Benjamin', 'Harper', 'Lucas'],
        model: 'x-ai/grok-4-1-fast',
      },
      chatroomTranscript: [],
      // failedAgents intentionally undefined — clean run
    };

    const doc = buildSwarmExecutionDocument(input(result));
    expect(doc.status).toBe('ok');
    expect(doc.failedAgents).toBeUndefined();
  });

  it("status is 'fail' when result.success is false (e.g. all-workers-fatal exit)", () => {
    const result: SwarmOrchestratorResult = {
      response: 'All Specialists Could Not Be Summoned',
      success: false,
      totalTokensUsed: 600,
      swarmId: 'swarm-allfatal-1',
      agentResults: [
        worker('Benjamin', false, 'oops'),
        worker('Harper', false, 'oops'),
        worker('Lucas', false, 'oops'),
      ],
      leaderResult: {
        synthesis: '',
        success: false,
        tokensUsed: 0,
        roundsUsed: 0,
        agentsHeardFrom: [],
        model: 'swarm-all-fatal',
        error: 'All 3 workers failed: ...',
      },
      chatroomTranscript: [],
      failedAgents: ['Benjamin', 'Harper', 'Lucas'],
    };

    const doc = buildSwarmExecutionDocument(input(result));
    expect(doc.status).toBe('fail');
    expect(doc.failedAgents).toEqual(['Benjamin', 'Harper', 'Lucas']);
    expect(doc.leaderError).toContain('All 3 workers failed');
  });

  it("statusOverride still wins over computed status (e.g. 'running' on first persist)", () => {
    const result: SwarmOrchestratorResult = {
      response: '',
      success: false,
      totalTokensUsed: 0,
      swarmId: 'swarm-running-1',
      agentResults: [],
      leaderResult: {
        synthesis: '',
        success: false,
        tokensUsed: 0,
        roundsUsed: 0,
        agentsHeardFrom: [],
        model: 'pending',
      },
      chatroomTranscript: [],
    };
    const doc = buildSwarmExecutionDocument({
      ...input(result),
      statusOverride: 'running',
      agentCountOverride: 3,
    });
    expect(doc.status).toBe('running');
  });

  it("infers failedAgents from agentResults when result.failedAgents is missing (legacy callers)", () => {
    const result: SwarmOrchestratorResult = {
      response: 'Synthesis with one gap.',
      success: true,
      totalTokensUsed: 3500,
      swarmId: 'swarm-legacy-1',
      agentResults: [worker('Benjamin', true), worker('Harper', false, 'oops')],
      leaderResult: {
        synthesis: 'Synthesis with one gap.',
        success: true,
        tokensUsed: 500,
        roundsUsed: 1,
        agentsHeardFrom: ['Benjamin'],
        model: 'x-ai/grok-4-1-fast',
      },
      chatroomTranscript: [],
      // intentionally NO failedAgents on the result
    };
    const doc = buildSwarmExecutionDocument(input(result));
    // Status must still derive correctly from agentResults inspection.
    expect(doc.status).toBe('partial');
  });
});
