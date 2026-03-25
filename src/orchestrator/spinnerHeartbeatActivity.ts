// Spinner Heartbeat activity — updates the pending ack in-place with a Braille spinner frame.
// Called by the overseer on a timer when a session exceeds the spinner threshold (#267).
// Spec ref: 10-Teams-Interface.md §Message Flow

import * as df from 'durable-functions';
import {
  ActivityTypes,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
} from 'botbuilder';
import {
  getConversationReference,
  getPendingAckId,
} from '../bot/conversationStore.js';
import { getCorrelatedSpinnerAck } from '../bot/ackVariants.js';
import { getEnvConfig } from '../config/envConfig.js';

export interface SpinnerHeartbeatInput {
  userId: string;
  correlationTag: string;
}

export interface SpinnerHeartbeatResult {
  updated: boolean;
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

async function spinnerHeartbeat(input: SpinnerHeartbeatInput): Promise<SpinnerHeartbeatResult> {
  const ackActivityId = await getPendingAckId(input.userId);
  if (!ackActivityId) {
    // Ack already cleared (reply was sent) — nothing to update
    return { updated: false };
  }

  const conversationReference = await getConversationReference(input.userId);
  if (!conversationReference) {
    return { updated: false };
  }

  const adapter = getAdapter();
  const appId = getEnvConfig().microsoftAppId;
  const spinnerText = getCorrelatedSpinnerAck(input.correlationTag);

  try {
    await adapter.continueConversationAsync(
      appId,
      conversationReference as ConversationReference,
      async (turnContext) => {
        await turnContext.updateActivity({
          type: ActivityTypes.Message,
          id: ackActivityId,
          text: spinnerText,
          textFormat: 'markdown',
        });
      },
    );
    return { updated: true };
  } catch (err) {
    // Non-fatal — the ack may have been replaced already or the activity expired
    console.warn(
      `[spinnerHeartbeatActivity] Failed to update spinner for userId=${input.userId}: ${err instanceof Error ? err.message : err}`,
    );
    return { updated: false };
  }
}

df.app.activity('spinnerHeartbeatActivity', {
  handler: async (input: SpinnerHeartbeatInput): Promise<SpinnerHeartbeatResult> => {
    return spinnerHeartbeat(input);
  },
});
