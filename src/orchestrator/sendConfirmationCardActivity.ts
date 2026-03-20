// Send Confirmation Card activity — sends an Adaptive Card for human approval.
// Spec ref: 10-Teams-Interface.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import { BotFrameworkAdapter, type ConversationReference } from 'botbuilder';
import { buildConfirmationCard, type ConfirmationCardData } from '../bot/confirmationCards.js';
import { getConversationReference } from '../bot/conversationStore.js';

export interface SendConfirmationCardInput {
  userId: string;
  toolName: string;
  risk: 'medium' | 'high';
  description: string;
  correlationId: string;
}

export interface SendConfirmationCardResult {
  sent: boolean;
  error?: string;
}

df.app.activity('sendConfirmationCardActivity', {
  handler: async (input: SendConfirmationCardInput): Promise<SendConfirmationCardResult> => {
    try {
      const ref = await getConversationReference(input.userId);
      if (!ref) {
        return { sent: false, error: 'No conversation reference found' };
      }

      const appId = process.env['BOT_APP_ID'] ?? '';
      const adapter = new BotFrameworkAdapter({ appId, appPassword: '' });

      const cardData: ConfirmationCardData = {
        correlationId: input.correlationId,
        userId: input.userId,
        toolName: input.toolName,
        risk: input.risk,
        description: input.description,
      };

      const card = buildConfirmationCard(cardData);

      await adapter.continueConversation(
        ref as ConversationReference,
        async (context) => {
          await context.sendActivity({ attachments: [card] });
        },
      );

      return { sent: true };
    } catch (err) {
      return {
        sent: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
