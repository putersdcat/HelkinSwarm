// GitHub App installation token minting.
// Uses @octokit/auth-app to generate short-lived installation tokens.
// Credentials are injected as env vars from Key Vault references in Bicep.
// Issue: #121

import { createAppAuth } from '@octokit/auth-app';

// ---------------------------------------------------------------------------
// Token cache — avoid minting a new token on every tool call
// ---------------------------------------------------------------------------

let _cachedToken: string | undefined;
let _tokenExpiresAt: number = 0; // epoch ms

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a valid GitHub installation token, refreshing if within 5 min of expiry.
 * Reads GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY from env.
 */
export async function getGitHubInstallationToken(): Promise<string> {
  const nowMs = Date.now();
  const refreshThresholdMs = 5 * 60 * 1000; // refresh 5 min before expiry

  if (_cachedToken && nowMs < _tokenExpiresAt - refreshThresholdMs) {
    return _cachedToken;
  }

  const appId = process.env['GITHUB_APP_ID'];
  const installationId = process.env['GITHUB_APP_INSTALLATION_ID'];
  const privateKey = process.env['GITHUB_APP_PRIVATE_KEY'];

  if (!appId || !installationId || !privateKey) {
    throw new Error(
      'GitHub App credentials not configured. Ensure GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, ' +
      'and GITHUB_APP_PRIVATE_KEY are set via Key Vault references in Container App settings.'
    );
  }

  const auth = createAppAuth({
    appId: parseInt(appId, 10),
    privateKey,
    installationId: parseInt(installationId, 10),
  });

  const authResult = await auth({ type: 'installation' });

  _cachedToken = authResult.token;
  // Installation tokens are valid for 1 hour; cache for 55 min
  _tokenExpiresAt = nowMs + 55 * 60 * 1000;

  return _cachedToken;
}
