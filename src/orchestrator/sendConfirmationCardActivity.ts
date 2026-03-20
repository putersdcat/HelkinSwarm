// Send Confirmation Card activity — sends an Adaptive Card for human approval.
// Spec ref: 10-Teams-Interface.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
} from 'botbuilder';
import { buildConfirmationCard, type ConfirmationCardData } from '../bot/confirmationCards.js';
import { getConversationReference } from '../bot/conversationStore.js';
import { getEnvConfig } from '../config/envConfig.js';

export interface SendConfirmationCardInput {
  userId: string;
  toolName: string;
  risk: 'medium' | 'high';
  description: string;
  correlationId: string;
  sessionInstanceId: string;
}

export interface SendConfirmationCardResult {
  sent: boolean;
  error?: string;
}

let adapterInstance: CloudAdapter | undefined;

function getAdapter(): CloudAdapter {
  if (!adapterInstance) {
    const env = getEnvConfig();

    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: env.microsoftAppId,
      MicrosoftAppType: 'UserAssignedMSI',
      MicrosoftAppTenantId: env.microsoftAppTenantId,
    });
    adapterInstance = new CloudAdapter(auth);
  }
  return adapterInstance;
}

df.app.activity('sendConfirmationCardActivity', {
  handler: async (input: SendConfirmationCardInput): Promise<SendConfirmationCardResult> => {
    try {
      const conversationReference = await getConversationReference(input.userId);
      if (!conversationReference) {
        return { sent: false, error: 'No conversation reference found' };
      }

      const adapter = getAdapter();
      const appId = getEnvConfig().microsoftAppId;

      const cardData: ConfirmationCardData = {
        correlationId: input.correlationId,
        userId: input.userId,
        toolName: input.toolName,
        risk: input.risk,
        description: input.description,
        sessionInstanceId: input.sessionInstanceId,
      };

      const card = buildConfirmationCard(cardData);

      await adapter.continueConversationAsync(
        appId,
        conversationReference as ConversationReference,
        async (context) => {
          await context.sendActivity({ attachments: [card] });
        },
      );

      return { sent: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[sendConfirmationCardActivity] Failed to send card:', message);
      return { sent: false, error: message };
    }
  },
});
