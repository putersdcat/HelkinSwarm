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
  getMessagePathSnapshot: async () => ({
    status: 'ok',
    pendingTurns: 0,
    oldestPendingAgeMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
  }),
}));

vi.mock('../../src/bot/lifecycleNotices.js', () => ({
  getContainerAgeMs: mockGetContainerAgeMs,
}));

describe('healthHandler', () => {
  beforeEach(() => {
    resetLlmHealthTracker();
    mockGetContainerAgeMs.mockReset();
    mockGetContainerAgeMs.mockReturnValue(5 * 60_000);
    process.env['MICROSOFT_APP_ID'] = 'test-app-id';
    process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
    process.env['COSMOS_ENDPOINT'] = 'https://cosmos.example.com';
  });

  it('reports llm=ok when no aggregate failure state exists', async () => {
    const response = await healthHandler({} as never, {} as never);
    expect(response.status).toBe(200);
    const body = response.jsonBody as { components: { llm: string }, status: string };
    expect(body.components.llm).toBe('ok');
    expect(body.status).toBe('healthy');
  });

  it('reports llm=down and unhealthy when all known models are down', async () => {
    registerModels(['grok-4-1-fast-non-reasoning', 'gpt-5.4-mini']);
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('gpt-5.4-mini');
    reportLlmFailure('gpt-5.4-mini');

    const response = await healthHandler({} as never, {} as never);
    expect(response.status).toBe(200);
    const body = response.jsonBody as { components: { llm: string }, status: string };
    expect(body.components.llm).toBe('down');
    expect(body.status).toBe('unhealthy');
  });

  it('reports degraded during the post-start message acceptance gap', async () => {
    mockGetContainerAgeMs.mockReturnValue(60_000);

    const response = await healthHandler({} as never, {} as never);
    expect(response.status).toBe(200);
    const body = response.jsonBody as { components: { messagePath: string }, status: string };
    expect(body.components.messagePath).toBe('degraded');
    expect(body.status).toBe('degraded');
  });
});