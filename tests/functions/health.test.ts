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
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
  })),
}));

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getDatabase: () => ({
    read: async () => ({ ok: true }),
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
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
    });
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
});