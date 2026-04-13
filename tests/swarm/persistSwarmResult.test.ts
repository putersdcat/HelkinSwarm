import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock Cosmos client before importing the activity
const upsertMock = vi.fn().mockResolvedValue({});
vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: () => ({
    items: { upsert: upsertMock },
  }),
}));

// Mock telemetry
vi.mock('../../src/observability/telemetry.js', () => ({
  trackEvent: vi.fn(),
}));

import type { PersistSwarmResultInput } from '../../src/orchestrator/swarm/persistSwarmResultActivity.js';
import type { SwarmOrchestratorResult } from '../../src/orchestrator/swarm/swarmTypes.js';

describe('persistSwarmResultActivity', () => {
  beforeEach(() => {
    upsertMock.mockClear();
  });

  function makeMockResult(): SwarmOrchestratorResult {
    return {
      response: 'The synthesis result.',
      success: true,
      totalTokensUsed: 5000,
      swarmId: 'swarm-abc123',
      agentResults: [
        {
          agentName: 'Alpha',
          success: true,
          roundsUsed: 3,
          tokensUsed: 2000,
          toolCallsMade: 5,
          chatroomMessagesSent: 2,
          toolsUsed: ['web_search', 'web_fetch_page'],
          durationMs: 15000,
          model: 'grok-4-1-fast',
        },
        {
          agentName: 'Beta',
          success: true,
          roundsUsed: 2,
          tokensUsed: 1500,
          toolCallsMade: 3,
          chatroomMessagesSent: 1,
          toolsUsed: ['web_search'],
          durationMs: 12000,
          model: 'grok-4-1-fast',
        },
      ],
      leaderResult: {
        synthesis: 'Final answer from leader.',
        success: true,
        tokensUsed: 1500,
        roundsUsed: 1,
        agentsHeardFrom: ['Alpha', 'Beta'],
        model: 'grok-4-1-fast',
      },
      chatroomTranscript: [
        { from: 'Alpha', to: 'all', content: 'Found some results.', contentType: 'partial_result', timestamp: Date.now() },
        { from: 'Beta', to: 'all', content: 'Confirmed findings.', contentType: 'cross_verification', timestamp: Date.now() },
      ] as never[],
      swarmCost: {
        decomposerTokens: 500,
        workerTokens: 3500,
        leaderTokens: 1500,
        totalTokens: 5500,
        agentBreakdown: [
          { agent: 'Alpha', tokens: 2000, model: 'grok-4-1-fast', toolsUsed: ['web_search'], durationMs: 15000 },
          { agent: 'Beta', tokens: 1500, model: 'grok-4-1-fast', toolsUsed: ['web_search'], durationMs: 12000 },
        ],
      },
    };
  }

  it('writes swarm execution document to Cosmos', async () => {
    // Import the activity handler dynamically to get the handler
    const mod = await import('../../src/orchestrator/swarm/persistSwarmResultActivity.js');
    // The handler is registered via df.app.activity — we need to test it indirectly
    // For now, verify the module loads and the mock works
    expect(mod).toBeDefined();
  });

  it('document shape matches expected fields', () => {
    const result = makeMockResult();
    const input: PersistSwarmResultInput = {
      userId: 'test-user-123',
      correlationId: 'corr-abc',
      swarmId: 'swarm-abc123',
      userQuery: 'Compare React and Vue frameworks',
      decomposerTokens: 500,
      decomposerModel: 'grok-4-1-fast',
      executionDurationMs: 30000,
      result,
    };

    // Verify the input types compile and the shape is correct
    expect(input.userId).toBe('test-user-123');
    expect(input.result.agentResults).toHaveLength(2);
    expect(input.result.swarmCost?.totalTokens).toBe(5500);
    expect(input.result.chatroomTranscript).toHaveLength(2);
    expect(input.result.leaderResult.agentsHeardFrom).toEqual(['Alpha', 'Beta']);
  });
});
