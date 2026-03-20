// HelkinSwarm Bot — Teams activity handler.
// Receives messages, raises NewMessage external event on the user's overseer.
// Spec ref: 10-Teams-Interface.md, 08-Orchestrator-Patterns.md

import {
  TeamsActivityHandler,
  type TurnContext,
  TurnContext as TurnContextClass,
} from 'botbuilder';
import type { DurableClient } from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import type { NewMessageEvent } from '../orchestrator/overseer.js';
import { saveConversationReference, savePendingAckId } from './conversationStore.js';
import {
  getMaintenanceMode,
  isOwnerUserId,
  setMaintenanceMode,
} from './maintenanceMode.js';
import { promptShields } from '../llm/promptShields.js';

export class HelkinSwarmBot extends TeamsActivityHandler {
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
    const messageText = (context.activity.text ?? '').trim();
    const correlationId = crypto.randomUUID();

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

    console.info(
      `[HelkinSwarmBot] correlationId=${correlationId} userId=${userId} textLength=${messageText.length}`,
    );

    const maintenance = await getMaintenanceMode();
    const lowerMessage = messageText.toLowerCase();

    // Slash commands are handled before routing to the overseer.
    if (lowerMessage === '/emergency-stop') {
      await this.handleEmergencyStop(context, userId);
      return;
    }

    if (lowerMessage === '/emergency-resume') {
      await this.handleEmergencyResume(context, userId);
      return;
    }

    // /forge <idea> — SkillForge entry point (owner-only)
    if (lowerMessage.startsWith('/forge')) {
      await this.handleForge(context, userId, userAlias, messageText);
      return;
    }

    // /heavy <prompt> — force primary frontier model for this turn (owner-only)
    if (lowerMessage.startsWith('/heavy')) {
      await this.handleModelOverride(context, userId, userAlias, messageText, 'primary');
      return;
    }

    // /light <prompt> — force secondary fast model for this turn (owner-only)
    if (lowerMessage.startsWith('/light')) {
      await this.handleModelOverride(context, userId, userAlias, messageText, 'secondary');
      return;
    }

    if (maintenance.enabled) {
      await context.sendActivity('I am offline for maintenance.');
      return;
    }

    // Prompt Shields check on incoming user message (spec 0e, step 4)
    const shieldResult = await promptShields.check(messageText, correlationId);
    if (!shieldResult.clean) {
      const triggered = Object.entries(shieldResult.categories)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      console.warn(
        `[HelkinSwarmBot] Prompt Shields blocked input: correlationId=${correlationId} categories=${triggered}`,
      );
      await context.sendActivity(
        'I cannot process this request — it was flagged by the safety pipeline.',
      );
      return;
    }

    // Immediate ack before orchestration work begins.
    // Store the activityId so sendReplyActivity can replace it in-place
    // rather than sending a second message (spec: 10-Teams-Interface.md §Message Flow).
    const ackResponse = await context.sendActivity('⌛ Working on it...');
    if (ackResponse?.id) {
      const conversationId = context.activity.conversation?.id ?? userId;
      await savePendingAckId(userId, conversationId, ackResponse.id);
    }

    await this.raiseToOverseer(context, userId, userAlias, messageText);
  }

  /** Route a user message to the eternal overseer, starting it if needed. */
  private async raiseToOverseer(
    context: TurnContext,
    userId: string,
    userAlias: string,
    userMessage: string,
    modelOverride?: 'primary' | 'secondary',
  ): Promise<void> {
    const client = this.durableClient!;
    const instanceId = `overseer-${userId}`;

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
      await client.startNew('overseer', { instanceId });
    }

    const conversationReference = TurnContextClass.getConversationReference(
      context.activity,
    );
    await saveConversationReference(userId, conversationReference);

    const event: NewMessageEvent = {
      userMessage,
      conversationReference,
      userId,
      userAlias,
      ...(modelOverride !== undefined ? { modelOverride } : {}),
    };

    await client.raiseEvent(instanceId, 'NewMessage', event);
  }

  /** /forge <idea> — SkillForge entry point (owner-only). */
  private async handleForge(
    context: TurnContext,
    userId: string,
    userAlias: string,
    messageText: string,
  ): Promise<void> {
    if (!this.durableClient) return;

    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    const idea = messageText.slice(6).trim();

    if (process.env['SKILLFORGE_ENABLED'] !== 'true') {
      await context.sendActivity('⚙️ SkillForge is not enabled (set SKILLFORGE_ENABLED=true to activate).');
      return;
    }

    if (!idea) {
      await context.sendActivity('Usage: /forge <idea>');
      return;
    }

    await context.sendActivity(`⚙️ SkillForge: routing "${idea}" to the orchestrator...`);
    await this.raiseToOverseer(context, userId, userAlias, idea);
  }

  /** /heavy or /light — force a specific model tier for one turn (owner-only). */
  private async handleModelOverride(
    context: TurnContext,
    userId: string,
    userAlias: string,
    messageText: string,
    modelOverride: 'primary' | 'secondary',
  ): Promise<void> {
    if (!this.durableClient) return;

    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    const prompt = messageText.slice(6).trim();
    if (!prompt) {
      const cmd = modelOverride === 'primary' ? '/heavy' : '/light';
      await context.sendActivity(`Usage: ${cmd} <prompt>`);
      return;
    }

    const label = modelOverride === 'primary' ? '🔥 frontier model' : '⚡ fast model';
    await context.sendActivity(`⌛ Working on it... (${label})`);
    await this.raiseToOverseer(context, userId, userAlias, prompt, modelOverride);
  }

  private async handleEmergencyStop(
    context: TurnContext,
    userId: string,
  ): Promise<void> {
    if (!this.durableClient) return;

    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    const client = this.durableClient;

    try {
      await setMaintenanceMode({
        enabled: true,
        updatedBy: userId,
        reason: 'Emergency stop invoked via slash command',
      });

      const statuses = await client.getStatusAll();
      const activeStatuses = new Set<OrchestrationRuntimeStatus>([
        OrchestrationRuntimeStatus.Running,
        OrchestrationRuntimeStatus.Pending,
        OrchestrationRuntimeStatus.ContinuedAsNew,
      ]);

      const terminationTargets = statuses.filter(
        (status) =>
          status.instanceId &&
          status.runtimeStatus &&
          activeStatuses.has(status.runtimeStatus),
      );

      await Promise.all(
        terminationTargets.map((status) =>
          client.terminate(status.instanceId, 'Emergency stop invoked by owner'),
        ),
      );

      console.error(
        `[HelkinSwarmBot] P0 emergency stop activated by userId=${userId}; terminated=${terminationTargets.length}`,
      );

      await context.sendActivity(
        '⛔ Emergency stop executed. Maintenance mode is active. Send /emergency-resume to restore service.',
      );
    } catch (err: unknown) {
      console.error('[HelkinSwarmBot] Emergency stop failed:', err);
      await context.sendActivity(
        '⛔ Emergency stop failed. Check stamp logs immediately.',
      );
    }
  }

  private async handleEmergencyResume(
    context: TurnContext,
    userId: string,
  ): Promise<void> {
    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    await setMaintenanceMode({
      enabled: false,
      updatedBy: userId,
      reason: 'Emergency resume invoked via slash command',
    });

    console.error(`[HelkinSwarmBot] P0 emergency resume activated by userId=${userId}`);
    await context.sendActivity('✅ Maintenance mode cleared. HelkinSwarm is back online.');
  }
}
