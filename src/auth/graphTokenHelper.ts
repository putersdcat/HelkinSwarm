// Graph token helper — retrieves cached user Graph tokens from the Bot Framework Token Service.
// Used by skills that need delegated access (Outlook, OneDrive, Calendar).
// Spec ref: 11-Authentication-Identity.md, Issue #117
//
// The token was originally cached when the user ran /link and completed the OAuth consent flow.
// This helper retrieves it without needing a TurnContext (works from Durable Activities).

import { getEnvConfig } from '../config/envConfig.js';
import { getConversationReference } from '../bot/conversationStore.js';
import { createBotUserTokenClient } from './botUserTokenClient.js';

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
    const tokenClient = await createBotUserTokenClient();
    const conversationReference = await getConversationReference(userId);
    const channelUserId = conversationReference?.user?.id ?? userId;
    const channelId = conversationReference?.channelId ?? '';

    console.error(
      `[graphTokenHelper] Attempting getUserToken: userId=${userId}, channelUserId=${channelUserId}, channelId=${channelId}, connection=${connName}, hasConvRef=${!!conversationReference}`,
    );

    // Wrap with timeout — Bot Framework Token Service can hang indefinitely under
    // certain network conditions causing container restarts (#591).
    const TOKEN_SERVICE_TIMEOUT_MS = 12_000;
    const timeoutPromise = new Promise<undefined>((resolve) =>
      setTimeout(() => {
        console.error(
          `[graphTokenHelper] getUserToken timed out after ${TOKEN_SERVICE_TIMEOUT_MS}ms for userId=${userId}`,
        );
        resolve(undefined);
      }, TOKEN_SERVICE_TIMEOUT_MS),
    );
    const result = await Promise.race([
      tokenClient.getUserToken(
        channelUserId,
        connName,
        channelId,
        '', // magicCode — empty for cached token retrieval
      ),
      timeoutPromise,
    ]);

    if (!result?.token) {
      console.error(
        `[graphTokenHelper] getUserToken returned no token for userId=${userId} (channelUserId=${channelUserId}). Token Service may not have a cached token for connection '${connName}'.`,
      );
    }

    return result?.token;
  } catch (err) {
    console.error(`[graphTokenHelper] Failed to get Graph token for userId=${userId}: ${err}`);
    return undefined;
  }
}
