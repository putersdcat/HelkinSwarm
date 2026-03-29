import { ConfigurationBotFrameworkAuthentication, type Activity, type TurnContext } from 'botbuilder';
import { ClaimsIdentity } from 'botframework-connector';
import type { UserTokenClient } from 'botframework-connector';
import { getEnvConfig } from '../config/envConfig.js';

export interface TokenIdentityTuple {
  userId: string;
  channelId: string;
}

let authInstance: ConfigurationBotFrameworkAuthentication | undefined;

function getTurnUserTokenClient(context: TurnContext): UserTokenClient | undefined {
  const adapter = context.adapter as {
    UserTokenClientKey?: symbol | string;
  };
  const key = adapter.UserTokenClientKey;
  if (key === undefined) {
    return undefined;
  }

  const candidate = context.turnState.get(key);
  return candidate as UserTokenClient | undefined;
}

function getBotFrameworkAuthentication(): ConfigurationBotFrameworkAuthentication {
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

export async function createBotUserTokenClient(): Promise<UserTokenClient> {
  const env = getEnvConfig();
  const auth = getBotFrameworkAuthentication();

  return auth.createUserTokenClient(
    new ClaimsIdentity([{ type: 'appid', value: env.microsoftAppId }], true),
  );
}

export async function getSignInLinkForActivity(
  connectionName: string,
  activity: Activity,
): Promise<string | undefined> {
  const tokenClient = await createBotUserTokenClient();
  const resource = await tokenClient.getSignInResource(connectionName, activity, '');
  return resource.signInLink;
}

export async function getSignInLinkForTurnContext(
  context: TurnContext,
  connectionName: string,
): Promise<string | undefined> {
  const tokenClient = getTurnUserTokenClient(context) ?? await createBotUserTokenClient();
  const resource = await tokenClient.getSignInResource(connectionName, context.activity, '');
  return resource.signInLink;
}

export async function redeemMagicCodeForConnection(
  userId: string,
  channelId: string,
  connectionName: string,
  magicCode: string,
): Promise<string | undefined> {
  const tokenClient = await createBotUserTokenClient();
  const result = await tokenClient.getUserToken(userId, connectionName, channelId, magicCode);
  return result?.token;
}

export async function redeemMagicCodeForTurnContext(
  context: TurnContext,
  connectionName: string,
  magicCode: string,
): Promise<string | undefined> {
  const tokenClient = getTurnUserTokenClient(context) ?? await createBotUserTokenClient();
  const result = await tokenClient.getUserToken(
    context.activity.from.id,
    connectionName,
    context.activity.channelId ?? '',
    magicCode,
  );
  return result?.token;
}

export async function redeemMagicCodeWithFallbackForConnection(
  connectionName: string,
  magicCode: string,
  identities: TokenIdentityTuple[],
): Promise<(TokenIdentityTuple & { token: string }) | undefined> {
  const tokenClient = await createBotUserTokenClient();
  const seen = new Set<string>();

  for (const identity of identities) {
    const key = `${identity.userId}::${identity.channelId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    try {
      const result = await tokenClient.getUserToken(
        identity.userId,
        connectionName,
        identity.channelId,
        magicCode,
      );
      if (result?.token) {
        return {
          ...identity,
          token: result.token,
        };
      }
    } catch (err) {
      console.warn(
        `[botUserTokenClient] redeemMagicCodeWithFallbackForConnection failed: userId=${identity.userId}, channelId=${identity.channelId}, connection=${connectionName}, error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return undefined;
}

export async function checkUserTokenForConnection(
  userId: string,
  channelId: string,
  connectionName: string,
): Promise<string | undefined> {
  try {
    const tokenClient = await createBotUserTokenClient();
    const result = await tokenClient.getUserToken(userId, connectionName, channelId, '');
    return result?.token;
  } catch (err) {
    console.error(
      `[botUserTokenClient] checkUserTokenForConnection failed: userId=${userId}, channelId=${channelId}, connection=${connectionName}, error=${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

export async function checkUserTokenForTurnContext(
  context: TurnContext,
  connectionName: string,
): Promise<string | undefined> {
  try {
    const tokenClient = getTurnUserTokenClient(context) ?? await createBotUserTokenClient();
    const result = await tokenClient.getUserToken(
      context.activity.from.id,
      connectionName,
      context.activity.channelId ?? '',
      '',
    );
    return result?.token;
  } catch (err) {
    console.error(
      `[botUserTokenClient] checkUserTokenForTurnContext failed: userId=${context.activity.from.id}, channelId=${context.activity.channelId ?? ''}, connection=${connectionName}, error=${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

export async function signOutUserFromConnection(
  userId: string,
  channelId: string,
  connectionName: string,
): Promise<void> {
  const tokenClient = await createBotUserTokenClient();
  await tokenClient.signOutUser(userId, connectionName, channelId);
}

export async function signOutUserFromTurnContext(
  context: TurnContext,
  connectionName: string,
): Promise<void> {
  const tokenClient = getTurnUserTokenClient(context) ?? await createBotUserTokenClient();
  await tokenClient.signOutUser(
    context.activity.from.id,
    connectionName,
    context.activity.channelId ?? '',
  );
}