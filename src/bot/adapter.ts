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
import { recordMessagePathGlobalFailure } from '../observability/messagePathHealth.js';

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

  // Global error handler — log with correlation ID and fail fast.
  // Do NOT attempt another sendActivity() here: when the outbound Bot Framework
  // auth/send path is already broken, a secondary send can amplify the failure
  // and keep the HTTP turn hanging (#214).
  sharedAdapter.onTurnError = async (context, error) => {
    const correlationId = crypto.randomUUID();
    await recordMessagePathGlobalFailure(
      error instanceof Error ? error.message : String(error),
    );
    console.error(`[HelkinSwarm Bot] correlationId=${correlationId} Unhandled turn error:`, error);
    void context;
  };

  return sharedAdapter;
}
