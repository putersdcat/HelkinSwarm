// Send Confirmation Card activity — sends an Adaptive Card for human approval.
// Spec ref: 10-Teams-Interface.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
} from 'botbuilder';
import { buildConfirmationCard, type ConfirmationCardData } from '../bot/confirmationCards.js';
import {
  claimOutboundArtifact,
  getConversationReference,
  releaseOutboundArtifactClaim,
} from '../bot/conversationStore.js';
import { getEnvConfig } from '../config/envConfig.js';
import { recordOrchestratorStage } from '../observability/orchestratorStageHealth.js';

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
  skippedDuplicate?: boolean;
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

export async function sendConfirmationCard(
  input: SendConfirmationCardInput,
): Promise<SendConfirmationCardResult> {
  let resolvedConversationId = input.userId;
  let deliveredToUser = false;
  try {
    const conversationReference = await getConversationReference(input.userId);
    if (!conversationReference) {
      return { sent: false, error: 'No conversation reference found' };
    }

    const conversationId = conversationReference.conversation?.id ?? input.userId;
    resolvedConversationId = conversationId;
    const claimed = await claimOutboundArtifact(
      conversationId,
      input.userId,
      'confirmation-card',
      input.sessionInstanceId,
    );
    if (!claimed) {
      console.warn(
        `[sendConfirmationCardActivity] Duplicate confirmation card suppressed for sessionInstanceId=${input.sessionInstanceId}`,
      );
      return { sent: true, skippedDuplicate: true };
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
        deliveredToUser = true;
      },
    );

    await recordOrchestratorStage(
      input.correlationId,
      'awaiting-confirmation',
      input.userId,
    );

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      if (!deliveredToUser) {
        await releaseOutboundArtifactClaim(resolvedConversationId, 'confirmation-card', input.sessionInstanceId);
      }
    } catch {
      // Ignore cleanup failures — original send error is more important.
    }
    // eslint-disable-next-line no-console
    console.error('[sendConfirmationCardActivity] Failed to send card:', message);
    return { sent: false, error: message };
  }
}

df.app.activity('sendConfirmationCardActivity', {
  handler: async (input: SendConfirmationCardInput): Promise<SendConfirmationCardResult> => {
    return sendConfirmationCard(input);
  },
});
