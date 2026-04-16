import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertMock = vi.fn();
const fetchAllMock = vi.fn();
const queryMock = vi.fn(() => ({ fetchAll: fetchAllMock }));
const getContainerMock = vi.fn(() => ({
  items: {
    upsert: upsertMock,
    query: queryMock,
  },
}));

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: getContainerMock,
}));

const { MemoryManager } = await import('../../src/memory/memoryManager.js');

describe('MemoryManager agent session chains (#659)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue(undefined);
    fetchAllMock.mockResolvedValue({ resources: [] });
  });

  it('stores agent session summaries in the sessions container', async () => {
    const mm = new MemoryManager('user-1');

    await mm.storeAgentSessionSummary('Harper', 'Found 3 useful sources.');

    expect(getContainerMock).toHaveBeenCalledWith('sessions');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^agent-session-harper-/),
        userId: 'user-1',
        type: 'agent-session-summary',
        agentName: 'harper',
        content: 'Found 3 useful sources.',
        ttl: 72 * 60 * 60,
      }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
  });

  it('loads recent agent sessions from the sessions container with partition targeting', async () => {
    fetchAllMock.mockResolvedValue({
      resources: [
        { content: 'Newest summary' },
        { content: 'Older summary' },
      ],
    });
    const mm = new MemoryManager('user-2');

    const result = await mm.loadRecentAgentSessions('Benjamin', 2);

    expect(getContainerMock).toHaveBeenCalledWith('sessions');
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('c.type = @type AND c.agentName = @agentName'),
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: '@limit', value: 2 }),
          expect.objectContaining({ name: '@userId', value: 'user-2' }),
          expect.objectContaining({ name: '@type', value: 'agent-session-summary' }),
          expect.objectContaining({ name: '@agentName', value: 'benjamin' }),
        ]),
      }),
      expect.objectContaining({
        partitionKey: 'user-2',
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual(['Newest summary', 'Older summary']);
  });

  it('returns empty array when recent agent session query fails', async () => {
    fetchAllMock.mockRejectedValue(new Error('cosmos unavailable'));
    const mm = new MemoryManager('user-3');

    await expect(mm.loadRecentAgentSessions('Lucas')).resolves.toEqual([]);
  });
});
