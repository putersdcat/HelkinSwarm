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

function readGitHubAppSetting(primaryName: string, fallbackName: string): string | undefined {
  const primaryValue = process.env[primaryName]?.trim();
  if (primaryValue) {
    return primaryValue;
  }

  const fallbackValue = process.env[fallbackName]?.trim();
  return fallbackValue && fallbackValue.length > 0 ? fallbackValue : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a valid GitHub installation token, refreshing if within 5 min of expiry.
 * Reads SKILLFORGE_GITHUB_APP_ID, SKILLFORGE_GITHUB_APP_INSTALLATION_ID, and
 * SKILLFORGE_GITHUB_APP_PRIVATE_KEY from env, with fallback to legacy GITHUB_APP_* names.
 */
export async function getGitHubInstallationToken(): Promise<string> {
  const nowMs = Date.now();
  const refreshThresholdMs = 5 * 60 * 1000; // refresh 5 min before expiry

  if (_cachedToken && nowMs < _tokenExpiresAt - refreshThresholdMs) {
    return _cachedToken;
  }

  const appId = readGitHubAppSetting('SKILLFORGE_GITHUB_APP_ID', 'GITHUB_APP_ID');
  const installationId = readGitHubAppSetting('SKILLFORGE_GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_INSTALLATION_ID');
  const privateKey = readGitHubAppSetting('SKILLFORGE_GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY');

  if (!appId || !installationId || !privateKey) {
    throw new Error(
      'GitHub App credentials not configured. Ensure SKILLFORGE_GITHUB_APP_ID, ' +
      'SKILLFORGE_GITHUB_APP_INSTALLATION_ID, and SKILLFORGE_GITHUB_APP_PRIVATE_KEY are set ' +
      '(or fall back to the legacy GITHUB_APP_* names) via Key Vault references in Container App settings.'
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
