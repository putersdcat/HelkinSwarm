import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/bot/maintenanceMode.js', () => ({
  isOwnerUserId: vi.fn(async (userId: string) => userId === 'owner-user'),
}));

describe('roles policy authorities', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('grants owner policy override authorities', async () => {
    const { getUserAuthorities, getRoleSummary } = await import('../../src/auth/roles.js');

    await expect(getUserAuthorities('owner-user')).resolves.toEqual([
      'tool-use',
      'policy-override',
      'policy-override-high-risk',
    ]);

    const summary = await getRoleSummary('owner-user');
    expect(summary.authorities).toContain('policy-override-high-risk');
  });

  it('keeps guests on ordinary tool-use authority only', async () => {
    const { getUserAuthorities, hasAuthority } = await import('../../src/auth/roles.js');

    await expect(getUserAuthorities('guest-user')).resolves.toEqual(['tool-use']);
    await expect(hasAuthority('guest-user', 'policy-override')).resolves.toBe(false);
  });
});