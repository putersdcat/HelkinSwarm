import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertMock = vi.fn();
const fetchAllMock = vi.fn();
const queryMock = vi.fn(() => ({ fetchAll: fetchAllMock }));
const getContainerMock = vi.fn(() => ({
  items: {
    upsert: upsertMock,
    query: queryMock,
  },
  item: vi.fn(() => ({ delete: vi.fn() })),
}));
const embeddingMock = vi.fn().mockResolvedValue([0.25, 0.75]);

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: getContainerMock,
}));

vi.mock('../../src/llm/foundryClient.js', () => ({
  FoundryClient: class MockFoundryClient {
    async getEmbedding(text: string) {
      return embeddingMock(text);
    }
  },
}));

vi.mock('../../src/llm/modelRouter.js', () => ({
  getModelRouting: () => ({ lane: { primary: 'x-ai/grok-4.1-fast' } }),
}));

const { MemoryManager } = await import('../../src/memory/memoryManager.js');

describe('MemoryManager agentId scoping (#663)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue(undefined);
    fetchAllMock.mockResolvedValue({ resources: [] });
    embeddingMock.mockResolvedValue([0.25, 0.75]);
  });

  it('stores agent-scoped memory entries with agentId when constructor receives agentName', async () => {
    const mm = new MemoryManager('user-1', 'Harper');

    await mm.store({
      content: 'Primary source says pricing changed.',
      tags: ['swarm', 'partial_result'],
      metadata: { source: 'swarm' },
    });

    expect(getContainerMock).toHaveBeenCalledWith('multimodalMemory');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        agentId: 'harper',
        content: 'Primary source says pricing changed.',
      }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
  });

  it('scopes recall queries to agentId when constructor receives agentName', async () => {
    fetchAllMock.mockResolvedValue({
      resources: [{ content: 'Harper memory', score: 0.1, tags: ['swarm'], createdAt: '2026-04-16T00:00:00.000Z' }],
    });
    const mm = new MemoryManager('user-2', 'Benjamin');

    const results = await mm.recall('pricing check', { topK: 3, minScore: 0.5 });

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('c.agentId = @agentId'),
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: '@userId', value: 'user-2' }),
          expect.objectContaining({ name: '@agentId', value: 'benjamin' }),
        ]),
      }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
    expect(results[0]?.content).toBe('Harper memory');
  });

  it('global memory manager excludes agent-scoped entries from recall queries', async () => {
    const mm = new MemoryManager('user-3');

    await mm.recall('general query');

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('NOT IS_DEFINED(c.agentId)'),
      }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
  });
});
