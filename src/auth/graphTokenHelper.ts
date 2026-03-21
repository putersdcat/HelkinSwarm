// Graph token helper — retrieves cached user Graph tokens from the Bot Framework Token Service.
// Used by skills that need delegated access (Outlook, OneDrive, Calendar).
// Spec ref: 11-Authentication-Identity.md, Issue #117
//
// The token was originally cached when the user ran /link and completed the OAuth consent flow.
// This helper retrieves it without needing a TurnContext (works from Durable Activities).

import {
  ConfigurationBotFrameworkAuthentication,
} from 'botbuilder';
import { ClaimsIdentity } from 'botframework-connector';
import { getEnvConfig } from '../config/envConfig.js';

let authInstance: ConfigurationBotFrameworkAuthentication | undefined;

function getAuth(): ConfigurationBotFrameworkAuthentication {
  if (!authInstance) {
    const env = getEnvConfig();
    authInstance = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: env.microsoftAppId,
      MicrosoftAppType: 'UserAssignedMSI',
      MicrosoftAppTenantId: env.microsoftAppTenantId,
    });
  }
  return authInstance;
}

/**
 * Get a cached Graph access token for a user.
 * Returns the token string, or undefined if the user hasn't linked their account.
 *
 * @param userId - The user's AAD Object ID
 * @param connectionName - The OAuth connection name (default: from env config)
 */
export async function getGraphTokenForUser(
  userId: string,
  connectionName?: string,
): Promise<string | undefined> {
  const env = getEnvConfig();
  const connName = connectionName ?? env.botOAuthConnectionName;
  if (!connName) return undefined;

  try {
    const auth = getAuth();
    const tokenClient = await auth.createUserTokenClient(
      new ClaimsIdentity([], true),
    );

    const result = await tokenClient.getUserToken(
      userId,
      connName,
      '', // channelId — empty for proactive calls
      '', // magicCode — empty for cached token retrieval
    );

    return result?.token;
  } catch (err) {
    console.error(`[graphTokenHelper] Failed to get Graph token for userId=${userId}: ${err}`);
    return undefined;
  }
}
