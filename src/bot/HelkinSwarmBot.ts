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
import { getEnvConfig } from '../config/envConfig.js';
import { getAckVariant } from './ackVariants.js';
import { isColdStarting } from './lifecycleNotices.js';
import { loadCapabilities } from '../capabilities/capabilityLoader.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { parseDevLoopMessage } from '../devloop/radioProtocol.js';
import { createPendingIntent } from '../orchestrator/pendingIntentStore.js';
import { getBearerToken } from '../auth/identity.js';

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
    console.error(`[HelkinSwarmBot] SSO token exchange for userId=${userId}`);
    // Token is automatically cached by the Bot Framework in the configured connection.
    // MSAL Cosmos cache plugin (#30) handles persistence.
  }

  private async handleIncomingMessage(context: TurnContext): Promise<void> {
    const userId = context.activity.from.aadObjectId;
    const userAlias =
      context.activity.from.name ?? context.activity.from.id ?? 'unknown';
    let messageText = (context.activity.text ?? '').trim();
    const correlationId = crypto.randomUUID();

    // Extract quoted reply context from Teams reply-with-quote (#129, #166)
    const quoted = this.extractQuotedReply(context);
    if (quoted) {
      // Only warn about truncation when text was NOT resolved from our sent-message cache
      const truncNote = quoted.fromCache || quoted.text.length > 180 ? '' : ' (may be truncated by Teams)';
      messageText = `[Quoted context${truncNote}: "${quoted.text}"]\n\n${messageText}`;
    }

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

    // /link — trigger Graph OAuth consent flow (#31)
    if (lowerMessage === '/link') {
      await this.handleLink(context);
      return;
    }

    // /unlink — revoke Graph OAuth connection (#31)
    if (lowerMessage === '/unlink') {
      await this.handleUnlink(context, userId);
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
    const ackResponse = await context.sendActivity(getAckVariant());
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
    modelOverride?: 'primary' | 'secondary',
    imageUrls?: string[],
    devLoopContext?: NewMessageEvent['devLoopContext'],
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
   * /link — trigger Graph OAuth consent flow (#31).
   * Sends an OAuthCard that opens the Entra consent screen.
   * On successful sign-in, the Bot Framework caches the token in the configured connection.
   */
  private async handleLink(context: TurnContext): Promise<void> {
    const connectionName = getEnvConfig().botOAuthConnectionName;
    if (!connectionName) {
      await context.sendActivity('⚠️ OAuth connection not configured (BOT_OAUTH_CONNECTION_NAME).');
      return;
    }

    // Try to get an existing token first (user may already be linked)
    const tokenResponse = await (context.adapter as { getUserToken?(c: TurnContext, cn: string): Promise<{ token: string } | undefined> })
      .getUserToken?.(context, connectionName);

    if (tokenResponse?.token) {
      await context.sendActivity('✅ You are already linked! Your Graph credentials are active.');
      return;
    }

    // Send an OAuthCard to trigger the consent flow
    const card = CardFactory.oauthCard(
      connectionName,
      '🔗 Link your Microsoft account',
      'Sign in to grant HelkinSwarm access to your personal data (email, calendar, files).',
    );
    await context.sendActivity({ attachments: [card] });
  }

  /**
   * /unlink — revoke Graph OAuth tokens (#31).
   */
  private async handleUnlink(context: TurnContext, userId: string): Promise<void> {
    const connectionName = getEnvConfig().botOAuthConnectionName;
    if (!connectionName) {
      await context.sendActivity('⚠️ OAuth connection not configured.');
      return;
    }

    try {
      await (context.adapter as { signOutUser?(c: TurnContext, cn: string): Promise<void> })
        .signOutUser?.(context, connectionName);
      await context.sendActivity('✅ Unlinked. Your Graph credentials have been revoked.');
      console.error(`[HelkinSwarmBot] User unlinked: userId=${userId}`);
    } catch (err) {
      console.error('[HelkinSwarmBot] signOutUser failed:', err);
      await context.sendActivity('⚠️ Failed to unlink. Please try again or remove consent from https://myapps.microsoft.com');
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
  private extractQuotedReply(context: TurnContext): { text: string; fromCache: boolean } | undefined {
    const activity = context.activity;

    // 1. Cache lookup — if we sent the quoted message, we have the full text
    const replyToId = activity.replyToId;
    if (replyToId) {
      const cached = getSentMessage(replyToId);
      if (cached) {
        return { text: cached, fromCache: true };
      }
    }

    // 2. Check entities for 'quote' type (Teams SDK-provided structured quote)
    const entities = activity.entities;
    if (entities) {
      for (const entity of entities) {
        if (entity.type === 'quote' && typeof entity.text === 'string') {
          return { text: entity.text.trim(), fromCache: false };
        }
      }
    }

    // 3. Check channelData for quoted message content (Teams may include it here)
    const channelData = activity.channelData as Record<string, unknown> | undefined;
    if (channelData?.quotedMessageContent && typeof channelData.quotedMessageContent === 'string') {
      return { text: channelData.quotedMessageContent.trim(), fromCache: false };
    }

    // 4. Fallback: extract from HTML body if textFormat is 'html'
    if (activity.textFormat === 'html' && activity.text) {
      const blockquoteMatch = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i.exec(
        activity.text,
      );
      if (blockquoteMatch?.[1]) {
        // Strip HTML tags from the quoted content
        return { text: blockquoteMatch[1].replace(/<[^>]+>/g, '').trim(), fromCache: false };
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
