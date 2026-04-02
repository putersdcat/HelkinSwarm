import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAcquireTokenOnBehalfOf = vi.fn();
const mockAcquireCachedTokenForUser = vi.fn();
const mockLoadOboSession = vi.fn();
const mockTrackEvent = vi.fn();

vi.mock('../../src/config/safetyConfig.js', () => ({
  isReadOnly: () => false,
}));

vi.mock('../../src/auth/oboTokenProvider.js', () => ({
  acquireTokenOnBehalfOf: mockAcquireTokenOnBehalfOf,
  acquireCachedTokenForUser: mockAcquireCachedTokenForUser,
}));

vi.mock('../../src/auth/oboSessionStore.js', () => ({
  loadOboSession: mockLoadOboSession,
}));

vi.mock('../../src/observability/telemetry.js', () => ({
  trackEvent: mockTrackEvent,
}));

const { scopedTokenMinter } = await import('../../src/auth/scopedTokenMinter.js');

describe('scopedTokenMinter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses assertion-based OBO when an assertion is present', async () => {
    mockAcquireTokenOnBehalfOf.mockResolvedValue({
      accessToken: 'obo-token-1',
      expiresOn: new Date('2026-03-28T01:00:00.000Z'),
      scopes: ['Mail.Read'],
    });

    const token = await scopedTokenMinter.mint({
      toolName: 'outlook_list_emails',
      scope: 'read',
      targetResource: 'outlook',
      userId: 'user-1',
      correlationId: 'corr-1',
      assertion: 'exchange-token',
    });

    expect(token.method).toBe('obo');
    expect(token.token).toBe('obo-token-1');
    expect(mockAcquireTokenOnBehalfOf).toHaveBeenCalled();
  });

  it('uses cached silent OBO when a bootstrap session exists', async () => {
    mockLoadOboSession.mockResolvedValue({
      id: 'obo-session-user-2',
      userId: 'user-2',
      type: 'obo-session',
      localAccountId: 'local-2',
      bootstrappedAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      source: 'teams-token-exchange',
    });
    mockAcquireCachedTokenForUser.mockResolvedValue({
      accessToken: 'obo-token-silent',
      expiresOn: new Date('2026-03-28T01:00:00.000Z'),
      scopes: ['Mail.Read'],
    });

    const token = await scopedTokenMinter.mint({
      toolName: 'outlook_list_emails',
      scope: 'read',
      targetResource: 'outlook',
      userId: 'user-2',
      correlationId: 'corr-2',
    });

    expect(token.method).toBe('obo');
    expect(token.token).toBe('obo-token-silent');
    expect(mockAcquireCachedTokenForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      localAccountId: 'local-2',
    }));
  });

  it('falls back to placeholder when no delegated path is available', async () => {
    mockLoadOboSession.mockResolvedValue(undefined);

    const token = await scopedTokenMinter.mint({
      toolName: 'outlook_list_emails',
      scope: 'read',
      targetResource: 'outlook',
      userId: 'user-3',
      correlationId: 'corr-3',
    });

    expect(token.method).toBe('placeholder');
    expect(token.token.startsWith('placeholder_')).toBe(true);
  });

  it('requests Enterprise MCP delegated scopes for the graphenterprise skill domain', async () => {
    mockLoadOboSession.mockResolvedValue({
      id: 'obo-session-user-4',
      userId: 'user-4',
      type: 'obo-session',
      localAccountId: 'local-4',
      bootstrappedAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      source: 'teams-token-exchange',
    });
    mockAcquireCachedTokenForUser.mockResolvedValue({
      accessToken: 'enterprise-mcp-token',
      expiresOn: new Date('2026-04-02T01:00:00.000Z'),
      scopes: ['api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/MCP.User.Read.All'],
    });

    const token = await scopedTokenMinter.mint({
      toolName: 'graphenterprise_get',
      scope: 'read',
      targetResource: 'graphenterprise',
      userId: 'user-4',
      correlationId: 'corr-4',
    });

    expect(token.method).toBe('obo');
    expect(token.token).toBe('enterprise-mcp-token');
    expect(mockAcquireCachedTokenForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-4',
      scopes: expect.arrayContaining([
        'api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/MCP.User.Read.All',
        'api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/MCP.Organization.Read.All',
      ]),
    }));
  });
});