import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock getEnvConfig before importing the module under test
vi.mock('../../src/config/envConfig.js', () => ({
  getEnvConfig: () => ({
    microsoftAppId: 'test-app-id',
    microsoftAppTenantId: 'test-tenant-id',
  }),
}));

const mockGetUserToken = vi.fn();
const mockSignOutUser = vi.fn();
const mockGetSignInResource = vi.fn();

vi.mock('botbuilder', () => {
  class MockAuth {
    createUserTokenClient() {
      return Promise.resolve({
        getUserToken: mockGetUserToken,
        signOutUser: mockSignOutUser,
        getSignInResource: mockGetSignInResource,
      });
    }
  }
  return { ConfigurationBotFrameworkAuthentication: MockAuth };
});

vi.mock('botframework-connector', () => ({
  ClaimsIdentity: vi.fn(),
}));

// Import after mocks are set up
const {
  checkUserTokenForConnection,
  signOutUserFromConnection,
  redeemMagicCodeForConnection,
  redeemMagicCodeWithFallbackForConnection,
} = await import('../../src/auth/botUserTokenClient.js');

describe('botUserTokenClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkUserTokenForConnection', () => {
    it('returns token when user has an active connection', async () => {
      mockGetUserToken.mockResolvedValue({ token: 'test-token-123' });

      const result = await checkUserTokenForConnection('user-1', 'msteams', 'GraphOAuth');

      expect(result).toBe('test-token-123');
      expect(mockGetUserToken).toHaveBeenCalledWith('user-1', 'GraphOAuth', 'msteams', '');
    });

    it('returns undefined when no token exists', async () => {
      mockGetUserToken.mockResolvedValue(null);

      const result = await checkUserTokenForConnection('user-1', 'msteams', 'GraphOAuth');

      expect(result).toBeUndefined();
    });

    it('returns undefined when token lookup throws', async () => {
      mockGetUserToken.mockRejectedValue(new Error('token service unavailable'));

      const result = await checkUserTokenForConnection('user-1', 'msteams', 'GraphOAuth');

      expect(result).toBeUndefined();
    });
  });

  describe('signOutUserFromConnection', () => {
    it('calls signOutUser with correct parameters', async () => {
      mockSignOutUser.mockResolvedValue(undefined);

      await signOutUserFromConnection('user-1', 'msteams', 'GraphOAuth');

      expect(mockSignOutUser).toHaveBeenCalledWith('user-1', 'GraphOAuth', 'msteams');
    });
  });

  describe('redeemMagicCodeForConnection', () => {
    it('returns token on successful code exchange', async () => {
      mockGetUserToken.mockResolvedValue({ token: 'exchanged-token' });

      const result = await redeemMagicCodeForConnection('user-1', 'msteams', 'GraphOAuth', 'abc123');

      expect(result).toBe('exchanged-token');
      expect(mockGetUserToken).toHaveBeenCalledWith('user-1', 'GraphOAuth', 'msteams', 'abc123');
    });

    it('returns undefined when code exchange fails', async () => {
      mockGetUserToken.mockResolvedValue(null);

      const result = await redeemMagicCodeForConnection('user-1', 'msteams', 'GraphOAuth', 'bad-code');

      expect(result).toBeUndefined();
    });
  });

  describe('redeemMagicCodeWithFallbackForConnection', () => {
    it('uses the first identity tuple that yields a token', async () => {
      mockGetUserToken
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ token: 'fallback-token' });

      const result = await redeemMagicCodeWithFallbackForConnection('GraphOAuth', 'abc123', [
        { userId: 'user-original', channelId: 'msteams' },
        { userId: 'user-current', channelId: 'msteams' },
      ]);

      expect(result).toEqual({
        userId: 'user-current',
        channelId: 'msteams',
        token: 'fallback-token',
      });
      expect(mockGetUserToken).toHaveBeenNthCalledWith(
        1,
        'user-original',
        'GraphOAuth',
        'msteams',
        'abc123',
      );
      expect(mockGetUserToken).toHaveBeenNthCalledWith(
        2,
        'user-current',
        'GraphOAuth',
        'msteams',
        'abc123',
      );
    });

    it('skips duplicate identity tuples and continues after token client errors', async () => {
      mockGetUserToken
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce({ token: 'recovered-token' });

      const result = await redeemMagicCodeWithFallbackForConnection('GraphOAuth', 'abc123', [
        { userId: 'user-1', channelId: 'msteams' },
        { userId: 'user-1', channelId: 'msteams' },
        { userId: 'user-2', channelId: 'emulator' },
      ]);

      expect(result).toEqual({
        userId: 'user-2',
        channelId: 'emulator',
        token: 'recovered-token',
      });
      expect(mockGetUserToken).toHaveBeenCalledTimes(2);
    });
  });
});
