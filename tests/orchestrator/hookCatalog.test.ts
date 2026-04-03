import { afterEach, describe, expect, it, vi } from 'vitest';

const patchMock = vi.fn();
const itemMock = vi.fn(() => ({
  patch: patchMock,
}));

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: () => ({
    item: itemMock,
  }),
}));

describe('hookCatalog recordHookFired', () => {
  afterEach(() => {
    patchMock.mockReset();
    itemMock.mockClear();
  });

  it('uses an add patch op so first fire succeeds when lastFiredAt is absent', async () => {
    patchMock.mockResolvedValue(undefined);

    const { recordHookFired } = await import('../../src/orchestrator/hookCatalog.js');
    await recordHookFired('hook-123', 'user-456');

    expect(itemMock).toHaveBeenCalledWith('hook-123', 'user-456');
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock.mock.calls[0]?.[0]).toMatchObject({
      operations: [
        {
          op: 'add',
          path: '/lastFiredAt',
        },
      ],
    });
    expect(typeof patchMock.mock.calls[0]?.[0]?.operations?.[0]?.value).toBe('string');
  });
});