// Bot adapter factory — creates the CloudAdapter with UAMI auth.
// Exposes processActivity for Azure Functions v4 integration.
// Spec ref: 11-Authentication-Identity.md, 10-Teams-Interface.md

import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type TurnContext,
  type Activity,
} from 'botbuilder';
import { getEnvConfig } from '../config/envConfig.js';

/** Return type from processActivity */
interface InvokeResponse {
  status: number;
  body?: unknown;
}

/** CloudAdapter subclass that exposes processActivity for Azure Functions v4. */
export class HelkinSwarmAdapter extends CloudAdapter {
  async processActivityForFunctions(
    authHeader: string,
    activity: Activity,
    logic: (context: TurnContext) => Promise<void>,
  ): Promise<InvokeResponse | undefined> {
    return this.processActivity(authHeader, activity, logic) as Promise<InvokeResponse | undefined>;
  }
}

let sharedAdapter: HelkinSwarmAdapter | undefined;

export function createAdapter(): HelkinSwarmAdapter {
  if (sharedAdapter) return sharedAdapter;

  const env = getEnvConfig();
  const appId = env.microsoftAppId;
  const tenantId = env.microsoftAppTenantId;

  const auth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: appId,
    MicrosoftAppType: 'UserAssignedMSI',
    MicrosoftAppTenantId: tenantId,
  });

  sharedAdapter = new HelkinSwarmAdapter(auth);

  // Global error handler — log with correlation ID, notify user, stay alive
  sharedAdapter.onTurnError = async (context, error) => {
    const correlationId = crypto.randomUUID();
    console.error(`[HelkinSwarm Bot] correlationId=${correlationId} Unhandled turn error:`, error);
    try {
      await context.sendActivity(
        `⚠️ An internal error occurred. Reference: ${correlationId}`,
      );
    } catch {
      // ignore secondary failure — the turn is already broken
    }
  };

  return sharedAdapter;
}
