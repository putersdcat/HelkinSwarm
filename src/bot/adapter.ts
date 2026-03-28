// Bot adapter factory — creates the CloudAdapter with UAMI auth.
// Exposes processActivity for Azure Functions v4 integration.
// Spec ref: 11-Authentication-Identity.md, 10-Teams-Interface.md

import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  MemoryStorage,
  TeamsSSOTokenExchangeMiddleware,
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

  // Teams SSO token exchange must be processed through the Bot Framework
  // middleware path so the exchange is performed against the OAuth connection
  // and deduplicated across concurrent clients. Without this, signin/tokenExchange
  // invokes bypass the supported exchange flow and fall back to legacy OAuth-card
  // behavior more often than they should (#349 / #330).
  if (env.botOAuthConnectionName) {
    sharedAdapter.use(
      new TeamsSSOTokenExchangeMiddleware(
        new MemoryStorage(),
        env.botOAuthConnectionName,
      ),
    );
  }

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
