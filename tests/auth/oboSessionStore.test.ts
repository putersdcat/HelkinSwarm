import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRead = vi.fn();
const mockDelete = vi.fn();
const mockUpsert = vi.fn();

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: () => ({
    item: () => ({
      read: mockRead,
      delete: mockDelete,
    }),
    items: {
      upsert: mockUpsert,
    },
  }),
}));

const { loadOboSession, saveOboSession, clearOboSession } = await import('../../src/auth/oboSessionStore.js');

describe('oboSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads an existing OBO session record', async () => {
    mockRead.mockResolvedValue({
      resource: {
        id: 'obo-session-user-1',
        userId: 'user-1',
        type: 'obo-session',
        localAccountId: 'local-1',
        bootstrappedAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        source: 'teams-token-exchange',
      },
    });

    const session = await loadOboSession('user-1');
    expect(session?.localAccountId).toBe('local-1');
  });

  it('returns undefined when no OBO session exists', async () => {
    mockRead.mockRejectedValue({ code: 404 });
    await expect(loadOboSession('missing')).resolves.toBeUndefined();
  });

  it('upserts an OBO session record', async () => {
    mockUpsert.mockResolvedValue(undefined);

    const record = await saveOboSession('user-2', {
      localAccountId: 'local-2',
      bootstrappedAt: '2026-03-28T00:00:00.000Z',
      lastCorrelationId: 'corr-2',
      source: 'teams-token-exchange',
    });

    expect(record.id).toBe('obo-session-user-2');
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'obo-session-user-2',
      userId: 'user-2',
      localAccountId: 'local-2',
    }));
  });

  it('treats delete of a missing session as a no-op', async () => {
    mockDelete.mockRejectedValue({ code: 404 });
    await expect(clearOboSession('user-3')).resolves.toBeUndefined();
  });
});