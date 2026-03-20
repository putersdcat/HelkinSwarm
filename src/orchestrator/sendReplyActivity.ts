// Send Reply activity — sends the bot response back to Teams via proactive messaging.
// Spec ref: 10-Teams-Interface.md, 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
} from 'botbuilder';
import { getConversationReference } from '../bot/conversationStore.js';

export interface SendReplyInput {
  /** User AAD Object ID — used to look up ConversationReference from Cosmos. */
  userId: string;
  message: string;
}

export interface SendReplyResult {
  success: boolean;
  error?: string;
}

// Shared adapter instance for proactive messaging.
// Uses the UAMI credentials from the Bot Service registration.
let adapterInstance: CloudAdapter | undefined;

function getAdapter(): CloudAdapter {
  if (!adapterInstance) {
    const appId = process.env['MicrosoftAppId'] ?? process.env['MICROSOFT_APP_ID'] ?? '';
    const tenantId = process.env['MicrosoftAppTenantId'] ?? process.env['MICROSOFT_APP_TENANT_ID'] ?? '';

    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: appId,
      MicrosoftAppType: 'UserAssignedMSI',
      MicrosoftAppTenantId: tenantId,
    });
    adapterInstance = new CloudAdapter(auth);
  }
  return adapterInstance;
}

async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  try {
    const adapter = getAdapter();
    const appId = process.env['MicrosoftAppId'] ?? process.env['MICROSOFT_APP_ID'] ?? '';

    // Read ConversationReference from Cosmos (survives container restarts)
    const conversationReference = await getConversationReference(input.userId);
    if (!conversationReference) {
      throw new Error(`No ConversationReference found in Cosmos for userId=${input.userId}`);
    }

    await adapter.continueConversationAsync(
      appId,
      conversationReference as ConversationReference,
      async (turnContext) => {
        await turnContext.sendActivity(input.message);
      },
    );
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Log prominently so it surfaces in Function App logs / Application Insights
    console.error('[sendReplyActivity] FATAL: Proactive reply to Teams failed:', message);
    // Throw so the Durable activity is marked failed and the failure is visible
    // in orchestration history. Let the overseer handle the failure cleanly.
    throw new Error(`Proactive reply failed: ${message}`);
  }
}

df.app.activity('sendReplyActivity', {
  handler: async (input: SendReplyInput): Promise<SendReplyResult> => {
    return sendReply(input);
  },
});
