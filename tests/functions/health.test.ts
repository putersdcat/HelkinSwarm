import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerModels,
  reportLlmFailure,
  resetLlmHealthTracker,
} from '../../src/llm/llmHealthTracker.js';
import { healthHandler } from '../../src/functions/health.js';

const { mockGetContainerAgeMs } = vi.hoisted(() => ({
  mockGetContainerAgeMs: vi.fn(() => 5 * 60_000),
}));

const { mockGetMessagePathSnapshot } = vi.hoisted(() => ({
  mockGetMessagePathSnapshot: vi.fn(async () => ({
    status: 'ok',
    pendingTurns: 0,
    oldestPendingAgeMs: null,
    lastAcceptedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
  })),
}));

const { mockFetchAllSwarmExecutions } = vi.hoisted(() => ({
  mockFetchAllSwarmExecutions: vi.fn(async () => ({ resources: [] })),
}));

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getDatabase: () => ({
    read: async () => ({ ok: true }),
  }),
  getContainer: () => ({
    items: {
      query: () => ({
        fetchAll: mockFetchAllSwarmExecutions,
      }),
    },
  }),
}));

vi.mock('../../src/bot/conversationStore.js', () => ({
  getPendingAckSnapshot: async () => ({
    pendingAcks: 0,
    oldestPendingAgeMs: null,
    stalePendingAcks: 0,
    oldestStalePendingAgeMs: null,
  }),
}));

vi.mock('../../src/observability/messagePathHealth.js', () => ({
  getMessagePathSnapshot: mockGetMessagePathSnapshot,
}));

vi.mock('../../src/bot/lifecycleNotices.js', () => ({
  getContainerAgeMs: mockGetContainerAgeMs,
}));

describe('healthHandler', () => {
  beforeEach(() => {
    resetLlmHealthTracker();
    mockGetContainerAgeMs.mockReset();
    mockGetContainerAgeMs.mockReturnValue(5 * 60_000);
    mockGetMessagePathSnapshot.mockReset();
    mockGetMessagePathSnapshot.mockResolvedValue({
      status: 'ok',
      pendingTurns: 0,
      oldestPendingAgeMs: null,
      lastAcceptedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
    });
    mockFetchAllSwarmExecutions.mockReset();
    mockFetchAllSwarmExecutions.mockResolvedValue({ resources: [] });
    process.env['MICROSOFT_APP_ID'] = 'test-app-id';
    process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
    process.env['COSMOS_ENDPOINT'] = 'https://cosmos.example.com';
  });

  it('reports llm=ok when no aggregate failure state exists', async () => {
    mockGetContainerAgeMs.mockReturnValue(20 * 60_000);

    const response = await healthHandler({} as never, {} as never);
    expect(response.status).toBe(200);
    const body = response.jsonBody as { components: { llm: string }, status: string };
    expect(body.components.llm).toBe('ok');
    expect(body.status).toBe('healthy');
  });

  it('reports llm=down and unhealthy when all known models are down', async () => {
    registerModels(['grok-4-1-fast-non-reasoning', 'o4-mini']);
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('o4-mini');
    reportLlmFailure('o4-mini');

    const response = await healthHandler({} as never, {} as never);
    expect(response.status).toBe(200);
    const body = response.jsonBody as { components: { llm: string }, status: string };
    expect(body.components.llm).toBe('down');
    expect(body.status).toBe('unhealthy');
  });

  it('reports degraded during the post-start message acceptance gap', async () => {
    mockGetContainerAgeMs.mockReturnValue(5 * 60_000);

    const response = await healthHandler({} as never, {} as never);
    expect(response.status).toBe(200);
    const body = response.jsonBody as { components: { messagePath: string }, status: string };
    expect(body.components.messagePath).toBe('degraded');
    expect(body.status).toBe('degraded');
  });

  it('recovers to healthy once the post-start readiness window has elapsed without other failures', async () => {
    mockGetContainerAgeMs.mockReturnValue(20 * 60_000);

    const response = await healthHandler({} as never, {} as never);
    expect(response.status).toBe(200);
    const body = response.jsonBody as { components: { messagePath: string }, status: string };
    expect(body.components.messagePath).toBe('ok');
    expect(body.status).toBe('healthy');
  });

  it('reports degraded again after prolonged inbound silence on an otherwise warm runtime', async () => {
    mockGetContainerAgeMs.mockReturnValue(20 * 60_000);
    mockGetMessagePathSnapshot.mockResolvedValue({
      status: 'ok',
      pendingTurns: 0,
      oldestPendingAgeMs: null,
      lastAcceptedAt: '2026-03-31T20:00:00.000Z',
      lastSuccessAt: '2026-03-31T20:00:00.000Z',
      lastFailureAt: null,
      lastFailureReason: null,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T20:11:00.000Z'));

    try {
      const response = await healthHandler({} as never, {} as never);
      expect(response.status).toBe(200);
      const body = response.jsonBody as { components: { messagePath: string }, status: string };
      expect(body.components.messagePath).toBe('degraded');
      expect(body.status).toBe('degraded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays healthy when the last successful inbound turn is still recent', async () => {
    mockGetContainerAgeMs.mockReturnValue(20 * 60_000);
    mockGetMessagePathSnapshot.mockResolvedValue({
      status: 'ok',
      pendingTurns: 0,
      oldestPendingAgeMs: null,
      lastAcceptedAt: '2026-03-31T20:05:30.000Z',
      lastSuccessAt: '2026-03-31T20:05:30.000Z',
      lastFailureAt: null,
      lastFailureReason: null,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T20:11:00.000Z'));

    try {
      const response = await healthHandler({} as never, {} as never);
      expect(response.status).toBe(200);
      const body = response.jsonBody as { components: { messagePath: string }, status: string };
      expect(body.components.messagePath).toBe('ok');
      expect(body.status).toBe('healthy');
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes recent swarm audit persistence diagnostics for live viewer verification', async () => {
    mockGetContainerAgeMs.mockReturnValue(20 * 60_000);
    mockFetchAllSwarmExecutions.mockResolvedValue({
      resources: [
        { executedAt: '2026-03-31T20:10:00.000Z', success: false, status: 'fail', persistenceMode: 'compact-fallback' },
        { executedAt: '2026-03-31T20:09:00.000Z', success: true, status: 'ok', persistenceMode: 'full' },
      ],
    });

    const response = await healthHandler({} as never, {} as never);
    expect(response.status).toBe(200);
    const body = response.jsonBody as {
      diagnostics: {
        swarmAudit: {
          recentExecutions: number;
          lastPersistedAt: string | null;
          lastSuccessfulPersistedAt: string | null;
          lastFailedPersistedAt: string | null;
          lastPersistenceMode: string | null;
          staleRunningCount: number;
        };
      };
    };

    expect(body.diagnostics.swarmAudit).toEqual({
      recentExecutions: 2,
      lastPersistedAt: '2026-03-31T20:10:00.000Z',
      lastSuccessfulPersistedAt: '2026-03-31T20:09:00.000Z',
      lastFailedPersistedAt: '2026-03-31T20:10:00.000Z',
      lastPersistenceMode: 'compact-fallback',
      staleRunningCount: 0,
    });
  });

  it('[#706] does NOT count running placeholders as failures and surfaces staleRunningCount', async () => {
    // Regression lock for the silent-drop audit conflation: a swarm that
    // dies between the running-placeholder write and the final persist
    // leaves a doc with status='running' AND success=false. Previously this
    // bumped lastFailedPersistedAt as if it were a real swarm failure,
    // hiding the true #706 fingerprint. The honest report is:
    //   - lastFailedPersistedAt: only docs with status='fail'
    //   - staleRunningCount: docs with status='running' older than 5 min
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T20:30:00.000Z'));
    try {
      mockGetContainerAgeMs.mockReturnValue(20 * 60_000);
      mockFetchAllSwarmExecutions.mockResolvedValue({
        // Order matches what the prod ORDER BY executedAt DESC query returns.
        resources: [
          // Fresh running placeholder — still in flight, not stale yet.
          { executedAt: '2026-03-31T20:29:00.000Z', success: false, status: 'running', persistenceMode: 'full' },
          // Stale running placeholder — orchestrator died after this write.
          { executedAt: '2026-03-31T20:10:00.000Z', success: false, status: 'running', persistenceMode: 'full' },
          // Real success.
          { executedAt: '2026-03-31T20:00:00.000Z', success: true, status: 'ok', persistenceMode: 'full' },
        ],
      });

      const response = await healthHandler({} as never, {} as never);
      expect(response.status).toBe(200);
      const body = response.jsonBody as {
        diagnostics: {
          swarmAudit: {
            recentExecutions: number;
            lastPersistedAt: string | null;
            lastSuccessfulPersistedAt: string | null;
            lastFailedPersistedAt: string | null;
            lastPersistenceMode: string | null;
            staleRunningCount: number;
          };
        };
      };

      expect(body.diagnostics.swarmAudit).toEqual({
        recentExecutions: 3,
        // Latest doc by executedAt (the fresh running placeholder).
        lastPersistedAt: '2026-03-31T20:29:00.000Z',
        lastSuccessfulPersistedAt: '2026-03-31T20:00:00.000Z',
        // CRITICAL: must be null — none of these are real failures.
        lastFailedPersistedAt: null,
        lastPersistenceMode: 'full',
        // Only the 20:10 placeholder is older than 5 min vs the 20:30 clock.
        staleRunningCount: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});