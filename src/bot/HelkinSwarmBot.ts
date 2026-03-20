// HelkinSwarm Bot — Teams activity handler.
// Receives messages, raises NewMessage external event on the user's overseer.
// Spec ref: 10-Teams-Interface.md, 08-Orchestrator-Patterns.md

import {
  ActivityHandler,
  type TurnContext,
  TurnContext as TurnContextClass,
} from 'botbuilder';
import type { DurableClient } from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import type { NewMessageEvent } from '../orchestrator/overseer.js';

export class HelkinSwarmBot extends ActivityHandler {
  private durableClient: DurableClient | undefined;

  /** Inject the Durable client from the Azure Functions HTTP trigger. */
  setDurableClient(client: DurableClient): void {
    this.durableClient = client;
  }

  constructor() {
    super();

    this.onMessage(async (context: TurnContext, next) => {
      await this.handleIncomingMessage(context);
      await next();
    });

    this.onMembersAdded(async (context: TurnContext, next) => {
      const membersAdded = context.activity.membersAdded ?? [];
      for (const member of membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(
            'HelkinSwarm online. I am your personal sovereign AI copilot. Send me a message to begin.',
          );
        }
      }
      await next();
    });
  }

  private async handleIncomingMessage(context: TurnContext): Promise<void> {
    const userId = context.activity.from.aadObjectId;
    const userAlias =
      context.activity.from.name ?? context.activity.from.id ?? 'unknown';
    const messageText = context.activity.text ?? '';

    if (!userId) {
      await context.sendActivity(
        'Unable to identify your Entra ID. Please try again from a signed-in Teams client.',
      );
      return;
    }

    if (!this.durableClient) {
      await context.sendActivity(
        'Internal error: orchestrator client not available. Please try again.',
      );
      return;
    }

    // Emergency stop — immediate kill, no LLM needed
    if (messageText.trim().toLowerCase() === '/emergency-stop') {
      await this.handleEmergencyStop(context, userId);
      return;
    }

    // Get or start the eternal overseer instance for this user
    const instanceId = `overseer-${userId}`;
    const client = this.durableClient;

    // getStatus() throws (not returns null) when the instance doesn't exist yet (HTTP 404)
    let statusRuntimeStatus: OrchestrationRuntimeStatus | undefined;
    try {
      const status = await client.getStatus(instanceId);
      statusRuntimeStatus = status?.runtimeStatus;
    } catch {
      // 404 — orchestrator has never been started or was purged; treat as "not running"
      statusRuntimeStatus = undefined;
    }

    if (
      statusRuntimeStatus === undefined ||
      statusRuntimeStatus === OrchestrationRuntimeStatus.Completed ||
      statusRuntimeStatus === OrchestrationRuntimeStatus.Failed ||
      statusRuntimeStatus === OrchestrationRuntimeStatus.Terminated
    ) {
      // Start a new overseer instance — it will wait for the first NewMessage event
      await client.startNew('overseer', { instanceId });
    }

    // Build the event payload
    const conversationReference = TurnContextClass.getConversationReference(
      context.activity,
    );
    const event: NewMessageEvent = {
      userMessage: messageText,
      conversationReference,
      userId,
      userAlias,
    };

    // Raise the NewMessage event on the overseer
    await client.raiseEvent(instanceId, 'NewMessage', event);

    // Send a typing indicator while overseer processes
    await context.sendActivity({ type: 'typing' });
  }

  private async handleEmergencyStop(
    context: TurnContext,
    userId: string,
  ): Promise<void> {
    if (!this.durableClient) return;

    const instanceId = `overseer-${userId}`;
    const client = this.durableClient;

    try {
      await client.terminate(instanceId, 'Emergency stop invoked by user');
      await context.sendActivity(
        '⛔ Emergency stop executed. All operations terminated. Send a new message to restart.',
      );
    } catch {
      await context.sendActivity(
        '⛔ Emergency stop: no active session found. You are clear.',
      );
    }
  }
}
