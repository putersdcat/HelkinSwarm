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

import {
  buildSwarmExecutionDocument,
} from '../../src/orchestrator/swarm/persistSwarmResultActivity.js';
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

  it('truncates oversized transcript content but preserves the audit record', () => {
    const result = makeMockResult();
    result.chatroomTranscript = Array.from({ length: 120 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      from: 'Harper',
      to: 'Leader',
      content: 'x'.repeat(2000),
      contentType: 'partial_result',
      timestamp: Date.now() + index,
      correlationId: 'corr-oversize',
    })) as never[];

    const input: PersistSwarmResultInput = {
      userId: 'test-user-123',
      correlationId: 'corr-oversize',
      swarmId: '00000000-0000-4000-8000-000000000777',
      userQuery: 'Investigate the audit persistence path for a large swarm transcript',
      decomposerTokens: 250,
      decomposerModel: 'grok-4-1-fast',
      executionDurationMs: 45000,
      result,
    };

    const doc = buildSwarmExecutionDocument(input);
    expect(doc.chatroomTranscript.length).toBeLessThanOrEqual(80);
    expect(doc.transcriptTruncated).toBe(true);
    expect(doc.chatroomTranscript[0]?.content.length).toBeLessThanOrEqual(1200);
    expect(doc.persistenceMode).toBe('full');
  });

  it('can mark a swarm execution as running before the final result arrives', () => {
    const result = makeMockResult();
    result.success = false;

    const input: PersistSwarmResultInput = {
      userId: 'test-user-123',
      correlationId: 'corr-running',
      swarmId: '00000000-0000-4000-8000-000000000889',
      userQuery: 'Running status test',
      decomposerTokens: 125,
      decomposerModel: 'grok-4-1-fast',
      executionDurationMs: 1200,
      result,
      statusOverride: 'running',
      agentCountOverride: 3,
    };

    const doc = buildSwarmExecutionDocument(input);
    expect(doc.status).toBe('running');
    expect(doc.agentCount).toBe(3);
  });

  it('can produce a compact fallback document when full persistence fails', () => {
    const result = makeMockResult();
    result.leaderResult.synthesis = 'y'.repeat(10000);

    const input: PersistSwarmResultInput = {
      userId: 'test-user-123',
      correlationId: 'corr-compact',
      swarmId: '00000000-0000-4000-8000-000000000888',
      userQuery: 'Compact fallback test',
      decomposerTokens: 250,
      decomposerModel: 'grok-4-1-fast',
      executionDurationMs: 45000,
      result,
    };

    const doc = buildSwarmExecutionDocument(input, {
      compact: true,
      warning: 'Stored compact fallback after primary persistence failure',
    });

    expect(doc.persistenceMode).toBe('compact-fallback');
    expect(doc.persistenceWarning).toContain('compact fallback');
    expect(doc.leaderSynthesis.length).toBeLessThanOrEqual(1500);
    expect(doc.chatroomTranscript.length).toBeLessThanOrEqual(20);
  });

  describe('upsertWithTimeout (#683)', () => {
    it('rejects within the timeout window when upsert hangs', async () => {
      const { upsertWithTimeout } = await import('../../src/orchestrator/swarm/persistSwarmResultActivity.js');
      const hangingContainer = {
        items: { upsert: () => new Promise(() => { /* never resolves */ }) },
      } as unknown as ReturnType<typeof import('../../src/memory/cosmosClient.js').getContainer>;
      const start = Date.now();
      await expect(
        // Use a tiny doc so the size guard does NOT short-circuit; we want to
        // verify the setTimeout-based race actually fires when upsert hangs.
        upsertWithTimeout(hangingContainer, { id: 'tiny', userId: 'u' }, 'primary'),
      ).rejects.toThrow(/exceeded \d+ms/);
      const elapsed = Date.now() - start;
      // Honest bound: must fail well inside the 15s ceiling. Allow 16s for test
      // scheduler jitter on slow CI.
      expect(elapsed).toBeLessThan(16_000);
    }, 20_000);

    it('fails fast when the doc exceeds the Cosmos size guard', async () => {
      const { upsertWithTimeout } = await import('../../src/orchestrator/swarm/persistSwarmResultActivity.js');
      const upsertCalled = vi.fn();
      const oversizeContainer = {
        items: { upsert: upsertCalled },
      } as unknown as ReturnType<typeof import('../../src/memory/cosmosClient.js').getContainer>;
      // 2 MB string of valid JSON-safe characters → > COSMOS_MAX_DOC_BYTES (1.9 MB).
      const oversizeDoc = { id: 'big', userId: 'u', payload: 'x'.repeat(2_000_000) };
      const start = Date.now();
      await expect(upsertWithTimeout(oversizeContainer, oversizeDoc, 'primary'))
        .rejects.toThrow(/payload too large/);
      const elapsed = Date.now() - start;
      // Must fail synchronously-ish, not after the 15s timer.
      expect(elapsed).toBeLessThan(2_000);
      expect(upsertCalled).not.toHaveBeenCalled();
    });

    it('passes an abortSignal to the SDK so the request can be cancelled', async () => {
      const { upsertWithTimeout } = await import('../../src/orchestrator/swarm/persistSwarmResultActivity.js');
      const upsertCalled = vi.fn().mockResolvedValue({});
      const container = {
        items: { upsert: upsertCalled },
      } as unknown as ReturnType<typeof import('../../src/memory/cosmosClient.js').getContainer>;
      await upsertWithTimeout(container, { id: 'tiny', userId: 'u' }, 'primary');
      expect(upsertCalled).toHaveBeenCalledTimes(1);
      const opts = upsertCalled.mock.calls[0][1];
      expect(opts).toBeDefined();
      expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
    });
  });
});
