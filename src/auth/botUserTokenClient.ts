import { ConfigurationBotFrameworkAuthentication, type Activity } from 'botbuilder';
import { ClaimsIdentity } from 'botframework-connector';
import type { UserTokenClient } from 'botframework-connector';
import { getEnvConfig } from '../config/envConfig.js';

let authInstance: ConfigurationBotFrameworkAuthentication | undefined;

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