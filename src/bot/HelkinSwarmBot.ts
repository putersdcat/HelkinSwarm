// HelkinSwarm Bot — Teams activity handler.
// Receives messages, raises NewMessage external event on the user's overseer.
// Spec ref: 10-Teams-Interface.md, 08-Orchestrator-Patterns.md

import {
  TeamsActivityHandler,
  type TurnContext,
  TurnContext as TurnContextClass,
  type AdaptiveCardInvokeResponse,
  type AdaptiveCardInvokeValue,
  StatusCodes,
  CardFactory,
  ActivityTypes,
  type Attachment,
  type ConversationReference,
} from 'botbuilder';
import type { DurableClient } from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import type { NewMessageEvent } from '../orchestrator/overseer.js';
import { saveConversationReference, savePendingAckId } from './conversationStore.js';
import { getSentMessage } from './sentMessageCache.js';
import {
  getMaintenanceMode,
  isOwnerUserId,
  setMaintenanceMode,
} from './maintenanceMode.js';
import { promptShields } from '../llm/promptShields.js';
import {
  getDirectChatModelIncompatibilityReason,
  getSupportedDirectChatModelOverrides,
} from '../llm/modelRouter.js';
import { getEnvConfig } from '../config/envConfig.js';
import { getCorrelatedAck } from './ackVariants.js';
import { isColdStarting } from './lifecycleNotices.js';
import { loadCapabilities, getManifest, getLinkableSkills } from '../capabilities/capabilityLoader.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { parseDevLoopMessage } from '../devloop/radioProtocol.js';
import { createPendingIntent } from '../orchestrator/pendingIntentStore.js';
import { getBearerToken } from '../auth/identity.js';
import { buildSkillLinkSigninCard, buildSkillRelinkSigninCard } from './linkCards.js';
import type { QuotedContext } from './quotedContext.js';
import { trackEvent } from '../observability/telemetry.js';

interface SignInLinkCapableAdapter {
  getSignInLink?(context: TurnContext, connectionName: string): Promise<string>;
}

export class HelkinSwarmBot extends TeamsActivityHandler {
  private durableClient: DurableClient | undefined;

  private async sendFreshMessage(
    context: TurnContext,
    activity: { text?: string; attachments?: Attachment[]; textFormat?: string },
  ): Promise<void> {
    const adapter = context.adapter as {
      continueConversationAsync?: (
        botAppId: string,
        reference: Partial<ConversationReference>,
        logic: (turnContext: TurnContext) => Promise<void>,
      ) => Promise<void>;
    };

    if (!adapter.continueConversationAsync) {
      await context.sendActivity(activity);
      return;
    }

    const freshReference = {
      ...TurnContextClass.getConversationReference(context.activity),
      activityId: undefined,
    } satisfies Partial<ConversationReference>;

    await adapter.continueConversationAsync(
      getEnvConfig().microsoftAppId,
      freshReference,
      async (turnContext) => {
        await turnContext.sendActivity({
          type: ActivityTypes.Message,
          text: activity.text,
          textFormat: activity.textFormat,
          attachments: activity.attachments,
        });
      },
    );
  }

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

  /**
   * Handle Adaptive Card Action.Execute invocations (confirmation cards).
   * Routes the user's approve/deny back to the overseer as a Durable external event.
   */
  protected async onAdaptiveCardInvoke(
    _context: TurnContext,
    invokeValue: AdaptiveCardInvokeValue,
  ): Promise<AdaptiveCardInvokeResponse> {
    const verb = invokeValue.action?.verb;

    if (verb === 'tentative_action') {
      return this.handleTentativeActionInvoke(invokeValue);
    }

    const data = invokeValue.action?.data as
      | { action: string; correlationId: string; userId: string; toolName: string; sessionInstanceId: string }
      | undefined;

    if (!data?.correlationId || !data?.userId || !data?.sessionInstanceId) {
      return { statusCode: StatusCodes.BAD_REQUEST, type: 'application/vnd.microsoft.error', value: { message: 'Missing confirmation data' } };
    }

    if (this.durableClient) {
      const instanceId = data.sessionInstanceId;
      await this.durableClient.raiseEvent(instanceId, 'ConfirmationResponse', {
        action: data.action,
        correlationId: data.correlationId,
        toolName: data.toolName,
        respondedAt: new Date().toISOString(),
      });
    }

    const approved = data.action === 'approved';
    return {
      statusCode: StatusCodes.OK,
      type: 'application/vnd.microsoft.card.adaptive',
      value: {
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: approved
              ? `✅ Approved — executing ${data.toolName}`
              : `❌ Cancelled — ${data.toolName} will not execute`,
            wrap: true,
          },
        ],
      },
    };
  }

  /**
   * Handle tentative action approve/deny from Adaptive Card (#74).
   */
  private async handleTentativeActionInvoke(
    invokeValue: AdaptiveCardInvokeValue,
  ): Promise<AdaptiveCardInvokeResponse> {
    const data = invokeValue.action?.data as
      | { action: string; actionId: string; correlationId: string; userId: string; hookId: string }
      | undefined;

    if (!data?.actionId || !data?.userId) {
      return { statusCode: StatusCodes.BAD_REQUEST, type: 'application/vnd.microsoft.error', value: { message: 'Missing tentative action data' } };
    }

    const approved = data.action === 'approved';

    // Import dynamically to avoid circular dependencies at module level
    const { approveTentativeAction, denyTentativeAction } = await import('./tentativeActionBridge.js');
    if (approved) {
      await approveTentativeAction(data.actionId, data.userId);
    } else {
      await denyTentativeAction(data.actionId, data.userId);
    }

    return {
      statusCode: StatusCodes.OK,
      type: 'application/vnd.microsoft.card.adaptive',
      value: {
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: approved
              ? `✅ Action confirmed — proceeding`
              : `❌ Action cancelled`,
            wrap: true,
          },
        ],
      },
    };
  }

  /**
   * Handle Teams SSO token exchange (#31).
   * Called when the user completes the OAuth consent flow from the OAuthCard.
   */
  protected async handleTeamsSigninVerifyState(
    context: TurnContext,
    _query: unknown,
  ): Promise<void> {
    const userId = context.activity.from.aadObjectId ?? 'unknown';
    console.error(`[HelkinSwarmBot] SSO verify state for userId=${userId}`);
    await context.sendActivity('✅ Account linked successfully! I can now access your personal data (email, calendar, files) on your behalf.');
  }

  /**
   * Handle Teams SSO token exchange invoke (#31).
   * This is the Teams-specific handling for the tokenExchange activity.
   */
  protected async handleTeamsSigninTokenExchange(
    context: TurnContext,
    _query: unknown,
  ): Promise<void> {
    const userId = context.activity.from.aadObjectId ?? 'unknown';
    const connectionName = (context.activity.value as Record<string, unknown>)?.connectionName;
    const hasToken = !!(context.activity.value as Record<string, unknown>)?.token;
    console.error(
      `[HelkinSwarmBot] SSO token exchange for userId=${userId}, connection=${String(connectionName)}, hasToken=${hasToken}`,
    );

    // Verify the exchange succeeded by immediately attempting to retrieve the token (#252)
    try {
      const { getGraphTokenForUser } = await import('../auth/graphTokenHelper.js');
      const token = await getGraphTokenForUser(userId, typeof connectionName === 'string' ? connectionName : undefined);
      if (token) {
        console.error(`[HelkinSwarmBot] Token exchange verified — token retrieved for userId=${userId}`);
      } else {
        console.error(`[HelkinSwarmBot] WARNING: Token exchange callback fired but getUserToken returned undefined for userId=${userId}`);
      }
    } catch (err) {
      console.error(`[HelkinSwarmBot] ERROR during token exchange verification for userId=${userId}:`, err);
    }
  }

  private async handleIncomingMessage(context: TurnContext): Promise<void> {
    const userId = context.activity.from.aadObjectId;
    const userAlias =
      context.activity.from.name ?? context.activity.from.id ?? 'unknown';
    let messageText = (context.activity.text ?? '').trim();
    const correlationId = crypto.randomUUID();

    // Emit bot-receive trace phase (#269)
    trackEvent({
      name: 'BotMessageReceived',
      correlationId,
      userId: userId ?? 'unknown',
      properties: { userAlias, hasQuotedReply: String(!!this.extractQuotedReply(context)) },
    });

    // Extract quoted reply context as structured metadata (#278)
    const quotedContext = this.extractQuotedReply(context);

    if (!userId) {
      await context.sendActivity(
        'Unable to identify your Entra ID. Please try again from a signed-in Teams client.',
      );
      return;
    }

    // Cold-start guard: block processing for 3s after container start (#142)
    if (isColdStarting()) {
      await context.sendActivity('⏳ Starting up — please try again in a few seconds.');
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

    // /model <deployment-name> <prompt> — force a specific deployment for this turn (owner-only, #217)
    if (lowerMessage.startsWith('/model')) {
      await this.handleDirectModelOverride(context, userId, userAlias, messageText);
      return;
    }

    // /preferences — update communication preferences
    if (lowerMessage === '/preferences') {
      await this.raiseToOverseer(
        context,
        userId,
        userAlias,
        'I want to update my communication preferences. Please ask me about my preferences one at a time.',
      );
      return;
    }

    // /link [skill] [status] — generic skill linking framework (#183)
    if (lowerMessage.startsWith('/link')) {
      await this.handleLinkCommand(context, messageText);
      return;
    }

    // /unlink [skill] — disconnect a specific skill (#183)
    if (lowerMessage.startsWith('/unlink')) {
      await this.handleUnlinkCommand(context, userId, messageText);
      return;
    }

    // /relink [skill] — unlink + relink a skill (#183)
    if (lowerMessage.startsWith('/relink')) {
      await this.handleRelinkCommand(context, userId, messageText);
      return;
    }

    // /reload skills — hot-reload capability manifests (owner-only, #79)
    if (lowerMessage === '/reload skills') {
      if (!(await isOwnerUserId(userId))) {
        await context.sendActivity('⛔ Owner-only command.');
        return;
      }
      toolRegistry.clear();
      const result = await loadCapabilities();
      await context.sendActivity(
        `♻️ Skills reloaded: ${result.skillsLoaded} skills, ${result.toolsRegistered} tools` +
          (result.errors.length > 0
            ? `, ${result.errors.length} errors: ${result.errors.map((e) => e.path).join(', ')}`
            : ''),
      );
      return;
    }

    // /status — quick health snapshot
    if (lowerMessage === '/status') {
      const health = await getMaintenanceMode();
      const safe = process.env.SAFETY_MODE ?? 'confirmation-gated';
      const { APP_VERSION } = await import('../config/version.js');
      const version = APP_VERSION;
      const modeLabel = health.enabled
        ? (health.source === 'emergency-stop' ? 'E-STOP' : 'MAINTENANCE')
        : 'OFF';
      await context.sendActivity(
        `HelkinSwarm ${version} — ` +
          `maintenance: ${modeLabel}, ` +
          `safety: ${safe}, ` +
          `tools: ${toolRegistry.size}`,
      );
      return;
    }

    if (maintenance.enabled) {
      const mode = maintenance.source === 'emergency-stop'
        ? 'emergency stop is active. Send /emergency-resume to restore service.'
        : 'maintenance is in progress.';
      await context.sendActivity(`I am offline — ${mode}`);
      return;
    }

    // Parse DevLoop protocol markers (#147) — must happen before shields check
    const devLoopParsed = parseDevLoopMessage(messageText);

    // DEVLOOP-KILL emergency kill switch (#93) — abort all sessions immediately
    if (devLoopParsed.isDevLoop && devLoopParsed.body.toUpperCase().startsWith('KILL')) {
      await this.handleEmergencyStop(context, userId);
      return;
    }

    // Use clean message body (without protocol markers) for shields check (#132, #147).
    // DevLoop protocol markers trigger false positives in Prompt Shields.
    const textForShields = devLoopParsed.isDevLoop ? devLoopParsed.body : messageText;

    // Prompt Shields check on incoming user message (spec 0e, step 4)
    const shieldResult = await promptShields.check(textForShields, correlationId);
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

    // Immediate ack before orchestration work begins (#143 — rotating variants).
    // Store the activityId so sendReplyActivity can replace it in-place
    // rather than sending a second message (spec: 10-Teams-Interface.md §Message Flow).
    // Include compact correlation tag so the user can trace the turn (#267).
    const correlationTag = correlationId.slice(0, 8);
    const ackResponse = await context.sendActivity(getCorrelatedAck(correlationTag));
    if (ackResponse?.id) {
      const conversationId = context.activity.conversation?.id ?? userId;
      await savePendingAckId(userId, conversationId, ackResponse.id);
    }

    // Extract and download image attachments as base64 data URLs (#130, #165)
    const imageUrls = await this.extractImageDataUrls(context);

    const devLoopCtx = devLoopParsed.isDevLoop ? {
      isDevLoop: devLoopParsed.isDevLoop,
      prefix: devLoopParsed.prefix,
      correlationTag: devLoopParsed.correlationTag,
      body: devLoopParsed.body,
      hasOver: devLoopParsed.hasOver,
    } : undefined;

    try {
      await this.raiseToOverseer(
        context,
        userId,
        userAlias,
        messageText,
        undefined,
        imageUrls,
        devLoopCtx,
        correlationTag,
        quotedContext,
      );
    } catch (err) {
      // Overseer unreachable — persist as pending intent for startup recovery (#116)
      const conversationReference = TurnContextClass.getConversationReference(context.activity);
      const { trackingId } = await createPendingIntent({
        userId,
        messageText,
        conversationReferenceJson: JSON.stringify(conversationReference),
        imageUrls,
        devLoopContextJson: devLoopCtx ? JSON.stringify(devLoopCtx) : undefined,
      });
      await context.sendActivity(
        `⏳ Your message has been queued (tracking: ${trackingId}). I'll process it when I'm back online.`,
      );
      console.error(`[HelkinSwarmBot] Queued pending intent ${trackingId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Route a user message to the eternal overseer, starting it if needed. */
  private async raiseToOverseer(
    context: TurnContext,
    userId: string,
    userAlias: string,
    userMessage: string,
    modelOverride?: string,
    imageUrls?: string[],
    devLoopContext?: NewMessageEvent['devLoopContext'],
    correlationTag?: string,
    quotedContext?: QuotedContext,
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
      // Purge the old instance if it exists in a terminal state — required before startNew
      if (statusRuntimeStatus !== undefined) {
        try {
          await client.purgeInstanceHistory(instanceId);
        } catch {
          // Purge may fail if instance was already cleaned up — safe to ignore
        }
      }
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
      ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
      ...(devLoopContext !== undefined ? { devLoopContext } : {}),
      ...(correlationTag !== undefined ? { correlationTag } : {}),
      ...(quotedContext !== undefined ? { quotedContext } : {}),
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

    if (!getEnvConfig().skillforgeEnabled) {
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
    const ackResponse = await context.sendActivity(`⌛ Working on it... (${label})`);
    if (ackResponse?.id) {
      const conversationId = context.activity.conversation?.id ?? userId;
      await savePendingAckId(userId, conversationId, ackResponse.id);
    }
    await this.raiseToOverseer(context, userId, userAlias, prompt, modelOverride);
  }

  /** /model <deployment-name> <prompt> — force a specific Azure AI Foundry deployment for one turn (owner-only, #217). */
  private async handleDirectModelOverride(
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

    // Parse: /model <deployment-name> <prompt>
    const parts = messageText.slice(6).trim().split(/\s+/);
    const available = getSupportedDirectChatModelOverrides();
    if (parts.length < 2 || !parts[0]) {
      await context.sendActivity(`Usage: /model <deployment-name> <prompt>\n\nAvailable: ${available.join(', ')}`);
      return;
    }

    const deploymentName = parts[0]!;
    const prompt = parts.slice(1).join(' ');
    const incompatibilityReason = getDirectChatModelIncompatibilityReason(deploymentName);

    if (incompatibilityReason) {
      await context.sendActivity(
        `⚠️ \`${deploymentName}\` is not available via /model because it ${incompatibilityReason}.\n\nAvailable: ${available.join(', ')}`,
      );
      return;
    }

    const ackResponse = await context.sendActivity(`⌛ Working on it... (🎯 ${deploymentName})`);
    if (ackResponse?.id) {
      const conversationId = context.activity.conversation?.id ?? userId;
      await savePendingAckId(userId, conversationId, ackResponse.id);
    }
    await this.raiseToOverseer(context, userId, userAlias, prompt, deploymentName);
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
        source: 'emergency-stop',
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
      source: 'system',
      reason: 'Emergency resume invoked via slash command',
    });

    console.error(`[HelkinSwarmBot] P0 emergency resume activated by userId=${userId}`);
    await context.sendActivity('✅ Maintenance mode cleared. HelkinSwarm is back online.');
  }

  /**
   * /link [skill] [status] — generic skill linking framework (#183).
   * No args: list all linkable skills.
   * /link <skill>: initiate OAuth for that skill.
   * /link <skill> status: check link status.
   */
  private async handleLinkCommand(context: TurnContext, messageText: string): Promise<void> {
    const args = messageText.slice('/link'.length).trim().split(/\s+/).filter(Boolean);
    const skillDomain = args[0];
    const subcommand = args[1]?.toLowerCase();

    // No args — list all linkable skills
    if (!skillDomain) {
      const linkable = getLinkableSkills();
      if (linkable.length === 0) {
        await context.sendActivity('No skills require linking.');
        return;
      }
      const list = linkable
        .map((m) => `• **${m.domain}** — ${m.linkConfig!.description}`)
        .join('\n');
      await context.sendActivity(
        `Available skills to link:\n${list}\n\nUse \`/link <skill>\` to connect.`,
      );
      return;
    }

    const manifest = getManifest(skillDomain);
    if (!manifest?.linkConfig) {
      await context.sendActivity(
        `⚠️ Skill "${skillDomain}" not found or doesn't require linking.`,
      );
      return;
    }

    const { connectionName, displayName, description } = manifest.linkConfig;

    // /link <skill> status — check link status
    if (subcommand === 'status') {
      const tokenResponse = await (
        context.adapter as {
          getUserToken?(c: TurnContext, cn: string): Promise<{ token: string } | undefined>;
        }
      ).getUserToken?.(context, connectionName);
      if (tokenResponse?.token) {
        await context.sendActivity(`✅ **${manifest.domain}** is linked.`);
      } else {
        await context.sendActivity(
          `❌ **${manifest.domain}** is not linked. Use \`/link ${manifest.domain}\` to connect.`,
        );
      }
      return;
    }

    // /link <skill> — initiate OAuth
    const tokenResponse = await (
      context.adapter as {
        getUserToken?(c: TurnContext, cn: string): Promise<{ token: string } | undefined>;
      }
    ).getUserToken?.(context, connectionName);

    if (tokenResponse?.token) {
      await context.sendActivity(
        `✅ **${manifest.domain}** is already linked! Your credentials are active.`,
      );
      return;
    }

    const signInLink = await this.getSkillSignInLink(context, connectionName);
    const card = signInLink
      ? buildSkillLinkSigninCard(displayName, description, signInLink)
      : CardFactory.oauthCard(
          connectionName,
          `🔗 Link ${displayName}`,
          description,
        );
    await this.sendFreshMessage(context, { attachments: [card] });
  }

  /**
   * /unlink [skill] — revoke OAuth tokens for a skill (#183).
   * No args: list linked skills. With arg: unlink that skill.
   */
  private async handleUnlinkCommand(
    context: TurnContext,
    userId: string,
    messageText: string,
  ): Promise<void> {
    const skillDomain = messageText.slice('/unlink'.length).trim().split(/\s+/)[0];

    if (!skillDomain) {
      await context.sendActivity('Usage: `/unlink <skill>` — e.g., `/unlink outlook`');
      return;
    }

    const manifest = getManifest(skillDomain);
    if (!manifest?.linkConfig) {
      await context.sendActivity(
        `⚠️ Skill "${skillDomain}" not found or doesn't require linking.`,
      );
      return;
    }

    try {
      await (
        context.adapter as { signOutUser?(c: TurnContext, cn: string): Promise<void> }
      ).signOutUser?.(context, manifest.linkConfig.connectionName);
      await context.sendActivity(`✅ **${manifest.domain}** unlinked. Credentials revoked.`);
      console.error(`[HelkinSwarmBot] User unlinked skill=${manifest.domain} userId=${userId}`);
    } catch (err) {
      console.error('[HelkinSwarmBot] signOutUser failed:', err);
      await context.sendActivity(
        '⚠️ Failed to unlink. Please try again or remove consent from https://myapps.microsoft.com',
      );
    }
  }

  /**
   * /relink [skill] — unlink + relink a skill in one step (#183).
   */
  private async handleRelinkCommand(
    context: TurnContext,
    userId: string,
    messageText: string,
  ): Promise<void> {
    const skillDomain = messageText.slice('/relink'.length).trim().split(/\s+/)[0];

    if (!skillDomain) {
      await context.sendActivity('Usage: `/relink <skill>` — e.g., `/relink outlook`');
      return;
    }

    const manifest = getManifest(skillDomain);
    if (!manifest?.linkConfig) {
      await context.sendActivity(
        `⚠️ Skill "${skillDomain}" not found or doesn't require linking.`,
      );
      return;
    }

    // Unlink first (silently)
    try {
      await (
        context.adapter as { signOutUser?(c: TurnContext, cn: string): Promise<void> }
      ).signOutUser?.(context, manifest.linkConfig.connectionName);
      console.error(`[HelkinSwarmBot] Relink: unlinked skill=${manifest.domain} userId=${userId}`);
    } catch {
      // Ignore unlink failure — proceed to link anyway
    }

    // Then initiate the linking flow
    const signInLink = await this.getSkillSignInLink(context, manifest.linkConfig.connectionName);
    const card = signInLink
      ? buildSkillRelinkSigninCard(
          manifest.linkConfig.displayName,
          manifest.linkConfig.description,
          signInLink,
        )
      : CardFactory.oauthCard(
          manifest.linkConfig.connectionName,
          `🔗 Relink ${manifest.linkConfig.displayName}`,
          manifest.linkConfig.description,
        );
    await this.sendFreshMessage(context, { attachments: [card] });
  }

  private async getSkillSignInLink(
    context: TurnContext,
    connectionName: string,
  ): Promise<string | undefined> {
    const adapter = context.adapter as SignInLinkCapableAdapter;
    if (!adapter.getSignInLink) {
      return undefined;
    }

    try {
      return await adapter.getSignInLink(context, connectionName);
    } catch {
      return undefined;
    }
  }

  /**
   * Extract quoted reply text from Teams reply-with-quote messages (#129, #166).
   * Resolution order:
   *   1. Sent-message cache lookup via replyToId (full text, no API call)
   *   2. Entities with type 'quote' (Teams SDK structured quote)
   *   3. channelData.quotedMessageContent
   *   4. HTML blockquote extraction (Teams truncated preview fallback)
   *
   * Returns { text, fromCache } so callers know whether truncation warning is needed.
   */
  private extractQuotedReply(context: TurnContext): QuotedContext | undefined {
    const activity = context.activity;
    const replyToId = activity.replyToId;

    // 1. Cache lookup — if we sent the quoted message, we have the full text
    if (replyToId) {
      const cached = getSentMessage(replyToId);
      if (cached) {
        return { text: cached, replyToId, source: 'cache', mayBeTruncated: false };
      }
    }

    // 2. Check entities for 'quote' type (Teams SDK-provided structured quote)
    const entities = activity.entities;
    if (entities) {
      for (const entity of entities) {
        if (entity.type === 'quote' && typeof entity.text === 'string') {
          return { text: entity.text.trim(), replyToId, source: 'entity', mayBeTruncated: entity.text.length < 180 };
        }
      }
    }

    // 3. Check channelData for quoted message content (Teams may include it here)
    const channelData = activity.channelData as Record<string, unknown> | undefined;
    if (channelData?.quotedMessageContent && typeof channelData.quotedMessageContent === 'string') {
      return { text: channelData.quotedMessageContent.trim(), replyToId, source: 'channelData', mayBeTruncated: channelData.quotedMessageContent.length < 180 };
    }

    // 4. Fallback: extract from HTML body if textFormat is 'html'
    if (activity.textFormat === 'html' && activity.text) {
      const blockquoteMatch = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i.exec(
        activity.text,
      );
      if (blockquoteMatch?.[1]) {
        const stripped = blockquoteMatch[1].replace(/<[^>]+>/g, '').trim();
        return { text: stripped, replyToId, source: 'blockquote', mayBeTruncated: true };
      }
    }

    return undefined;
  }

  /**
   * Download Teams inline image attachments and convert to base64 data URLs (#130, #165).
   * Teams contentUrls are authenticated — the LLM API cannot access them directly.
   * We download here (where Bot Framework auth is available) and inline as data URLs.
   */
  private async extractImageDataUrls(context: TurnContext): Promise<string[]> {
    const attachments = context.activity.attachments;
    if (!attachments) return [];

    const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB per image
    const dataUrls: string[] = [];

    for (const attachment of attachments) {
      if (!attachment.contentType?.startsWith('image/') || !attachment.contentUrl) {
        continue;
      }

      try {
        // Teams image URLs require Bot Framework auth to download
        const token = await getBearerToken('https://api.botframework.com/.default');
        const response = await fetch(attachment.contentUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          console.warn(
            `[HelkinSwarmBot] Image download failed: ${response.status} ${response.statusText} url=${attachment.contentUrl}`,
          );
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > MAX_IMAGE_BYTES) {
          console.warn(
            `[HelkinSwarmBot] Image too large (${buffer.byteLength} bytes), skipping`,
          );
          continue;
        }

        dataUrls.push(`data:${attachment.contentType};base64,${buffer.toString('base64')}`);
      } catch (err) {
        console.warn(
          `[HelkinSwarmBot] Failed to download image: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return dataUrls;
  }
}
