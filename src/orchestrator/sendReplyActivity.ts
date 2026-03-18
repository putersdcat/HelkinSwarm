// Send Reply activity — sends the bot response back to Teams via proactive messaging.
// Spec ref: 10-Teams-Interface.md, 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
} from 'botbuilder';

export interface SendReplyInput {
  conversationReference: Partial<ConversationReference>;
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
    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: process.env['MicrosoftAppId'] ?? '',
      MicrosoftAppType: 'UserAssignedMSI',
      MicrosoftAppTenantId: process.env['MicrosoftAppTenantId'] ?? '',
    });
    adapterInstance = new CloudAdapter(auth);
  }
  return adapterInstance;
}

async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  try {
    const adapter = getAdapter();
    await adapter.continueConversationAsync(
      process.env['MicrosoftAppId'] ?? '',
      input.conversationReference as ConversationReference,
      async (turnContext) => {
        await turnContext.sendActivity(input.message);
      },
    );
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

df.app.activity('sendReplyActivity', {
  handler: async (input: SendReplyInput): Promise<SendReplyResult> => {
    return sendReply(input);
  },
});
