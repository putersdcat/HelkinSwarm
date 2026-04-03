// HelkinSwarm Bot — Teams activity handler.
// Receives messages, raises NewMessage external event on the user's overseer.
// Spec ref: 10-Teams-Interface.md, 08-Orchestrator-Patterns.md

import {
  TeamsActivityHandler,
  type FileConsentCardResponse,
  type TurnContext,
  TurnContext as TurnContextClass,
  type AdaptiveCardInvokeResponse,
  type AdaptiveCardInvokeValue,
  StatusCodes,
  CardFactory,
  ActivityTypes,
  type Attachment,
  type ConversationReference,
  type ResourceResponse,
} from 'botbuilder';
import type { DurableClient } from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import type { NewMessageEvent } from '../orchestrator/overseer.js';
import { clearPendingAckId, saveConversationReference, savePendingAckId } from './conversationStore.js';
import { getSentMessage } from './sentMessageCache.js';
import {
  getMaintenanceMode,
  isOwnerUserId,
  setMaintenanceMode,
} from './maintenanceMode.js';
import { promptShields } from '../llm/promptShields.js';
import {
  classifyRequestedTaskComplexity,
  getDirectChatModelIncompatibilityReason,
  getConsciousLaneAssessment,
  getConsciousLaneAssessmentForTurn,
  getSupportedDirectChatModelOverrides,
} from '../llm/modelRouter.js';
import { getEnvConfig } from '../config/envConfig.js';
import { getCorrelatedAck } from './ackVariants.js';
import { getContainerAgeMs, isColdStarting } from './lifecycleNotices.js';
import { loadCapabilities, getManifest, getLinkableSkills } from '../capabilities/capabilityLoader.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { parseDevLoopMessage } from '../devloop/radioProtocol.js';
import { createPendingIntent } from '../orchestrator/pendingIntentStore.js';
import { replayPendingIntent } from '../orchestrator/pendingIntentReplay.js';
import { createHash } from 'node:crypto';
import { getBearerToken } from '../auth/identity.js';
import {
  checkUserTokenForTurnContext,
  getSignInLinkForTurnContext,
  redeemMagicCodeWithFallbackForConnection,
  redeemMagicCodeForTurnContext,
  signOutUserFromTurnContext,
} from '../auth/botUserTokenClient.js';
import { getGraphTokenForUser } from '../auth/graphTokenHelper.js';
import { extractBotFrameworkAuthCode } from '../auth/magicCode.js';
import {
  clearPendingLinkChallenge,
  getPendingLinkChallengeForUser,
  type PendingLinkChallenge,
  registerPendingLinkChallenge,
} from '../auth/pendingLinkChallengeStore.js';
import { buildSkillLinkSigninCard, buildSkillRelinkSigninCard } from './linkCards.js';
import { extractMessageReferenceId, extractMessageReferencePreview } from './messageReference.js';
import type { QuotedContext } from './quotedContext.js';
import { trackEvent } from '../observability/telemetry.js';
import { clearOrchestratorStagesForInstanceIds } from '../observability/orchestratorStageHealth.js';
import { clearOboSession } from '../auth/oboSessionStore.js';
import { recoverStaleAck } from './staleAckRecovery.js';
import { promoteSkillForgeBundle } from '../orchestrator/skillForgePromotion.js';
import { renderSkillSearchCommandResponse } from './skillSearchCommand.js';
import { buildReadOnlyDiscoveryQuery, isReadOnlyDiscoveryRequest } from '../orchestrator/discoveryToolInjection.js';
import {
  buildRuntimeAssetPromptSummary,
  deleteRuntimeAsset,
  loadRuntimeAssetReference,
  persistRuntimeAsset,
  readRuntimeAssetContent,
} from '../integrations/runtimeAssetStore.js';
import { sendReply } from '../orchestrator/sendReplyActivity.js';
import { RuntimeFileConsentContextSchema } from '../orchestrator/sendReplyActivity.js';
import { ingestTeamsAttachments } from './inboundAttachmentIngestion.js';
import { buildOverseerDedupIdentity } from './overseerDedupIdentity.js';
import { buildTeamsNativeEmojiEasterEggReply } from './teamsNativeEmojiEasterEggs.js';
import { recordLimbicIngressDecision } from '../orchestrator/limbicIngressActivity.js';
import { resolveActiveOverseerSummary } from '../orchestrator/activeOverseerInstance.js';
import { getActiveTurnCountForUser, getActiveTurnStagesForUser } from '../observability/orchestratorStageHealth.js';
import {
  MAX_INTERRUPTION_DEPTH,
  readMindSessionGuardState,
  signalMindSessionAcquire,
} from '../orchestrator/mindSessionGuard.js';

const STALE_ACK_VALIDATION_DELAY_MS = 4_000;

type RaiseToOverseerResult =
  | { outcome: 'started' }
  | { outcome: 'duplicate' }
  | { outcome: 'queued'; trackingId: string; reason: string }
  | { outcome: 'deferred'; trackingId: string; reason: string };

export class HelkinSwarmBot extends TeamsActivityHandler {
  private durableClient: DurableClient | undefined;

  private extractInboundHtmlContent(activity: TurnContext['activity']): string | undefined {
    const findHostedContentHtml = (value: unknown, depth = 0): string | undefined => {
      if (depth > 4 || value === null || value === undefined) {
        return undefined;
      }

      if (typeof value === 'string') {
        return /<img\b/i.test(value) && /\/hostedContents\//i.test(value) ? value : undefined;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findHostedContentHtml(item, depth + 1);
          if (found) {
            return found;
          }
        }
        return undefined;
      }

      if (typeof value === 'object') {
        for (const child of Object.values(value as Record<string, unknown>)) {
          const found = findHostedContentHtml(child, depth + 1);
          if (found) {
            return found;
          }
        }
      }

      return undefined;
    };

    return findHostedContentHtml(activity.text)
      ?? findHostedContentHtml(activity.channelData)
      ?? findHostedContentHtml(activity.value);
  }

  /**
   * In-memory dedup cache for Teams adapter retries (#280).
   * Maps activity.id → timestamp. Prevents the same HTTP POST from being
   * processed twice when the adapter retries within milliseconds.
   * Static: survives across per-request HelkinSwarmBot instances within the same container.
   */
  private static readonly recentActivityIds = new Map<string, number>();
  private static readonly DEDUP_TTL_MS = 60_000;

  private async sendFreshMessage(
    context: TurnContext,
    activity: { text?: string; attachments?: Attachment[]; textFormat?: string },
  ): Promise<string | undefined> {
    const adapter = context.adapter as {
      continueConversationAsync?: (
        botAppId: string,
        reference: Partial<ConversationReference>,
        logic: (turnContext: TurnContext) => Promise<void>,
      ) => Promise<void>;
    };

    if (!adapter.continueConversationAsync) {
      const response = await context.sendActivity(activity);
      return response?.id;
    }

    const freshReference = {
      ...TurnContextClass.getConversationReference(context.activity),
      activityId: undefined,
    } satisfies Partial<ConversationReference>;

    let sentResponse: ResourceResponse | undefined;

    await adapter.continueConversationAsync(
      getEnvConfig().microsoftAppId,
      freshReference,
      async (turnContext) => {
        sentResponse = await turnContext.sendActivity({
          type: ActivityTypes.Message,
          text: activity.text,
          textFormat: activity.textFormat,
          attachments: activity.attachments,
        });
      },
    );

    return sentResponse?.id;
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

  protected override async handleTeamsFileConsentAccept(
    context: TurnContext,
    fileConsentCardResponse: FileConsentCardResponse,
  ): Promise<void> {
    try {
      const parsedContext = RuntimeFileConsentContextSchema.parse(fileConsentCardResponse.context as unknown);
      const loaded = await readRuntimeAssetContent({
        userId: parsedContext.userId,
        assetId: parsedContext.assetId,
      });

      if (!loaded || !fileConsentCardResponse.uploadInfo?.uploadUrl || !fileConsentCardResponse.uploadInfo.contentUrl) {
        await context.sendActivity('⚠️ File upload could not be completed because the runtime asset is no longer available.');
        return;
      }

      const content = loaded.content;
      const response = await fetch(fileConsentCardResponse.uploadInfo.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(content.byteLength),
          'Content-Range': `bytes 0-${content.byteLength - 1}/${content.byteLength}`,
          'Content-Type': parsedContext.contentType,
        },
        body: content,
      });

      if (!response.ok) {
        throw new Error(`Upload session rejected the file with status ${response.status}`);
      }

      await context.sendActivity({
        type: ActivityTypes.Message,
        attachments: [{
          contentType: 'application/vnd.microsoft.teams.card.file.info',
          contentUrl: fileConsentCardResponse.uploadInfo.contentUrl,
          name: fileConsentCardResponse.uploadInfo.name,
          content: {
            uniqueId: fileConsentCardResponse.uploadInfo.uniqueId,
            fileType: fileConsentCardResponse.uploadInfo.fileType,
          },
        }],
      });

      await deleteRuntimeAsset({
        userId: parsedContext.userId,
        assetId: parsedContext.assetId,
      });
    } catch (err) {
      console.error('[HelkinSwarmBot] File consent accept failed:', err);
      await context.sendActivity(`⚠️ File upload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  protected override async handleTeamsFileConsentDecline(
    context: TurnContext,
    fileConsentCardResponse: FileConsentCardResponse,
  ): Promise<void> {
    try {
      const parsedContext = RuntimeFileConsentContextSchema.parse(fileConsentCardResponse.context as unknown);
      await deleteRuntimeAsset({
        userId: parsedContext.userId,
        assetId: parsedContext.assetId,
      });
    } catch {
      // Best-effort cleanup only.
    }

    await context.sendActivity('Okay — I canceled the file send.');
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
    const exchangeToken = (context.activity.value as Record<string, unknown>)?.token;
    const hasToken = typeof exchangeToken === 'string' && exchangeToken.length > 0;
    console.error(
      `[HelkinSwarmBot] SSO token exchange for userId=${userId}, connection=${String(connectionName)}, hasToken=${hasToken}`,
    );

    if (hasToken) {
      try {
        const { bootstrapOboSession } = await import('../auth/oboSessionBootstrap.js');
        const bootstrap = await bootstrapOboSession({
          userId,
          assertion: exchangeToken as string,
          correlationId: `sso-${crypto.randomUUID()}`,
        });
        console.error(
          `[HelkinSwarmBot] OBO session bootstrapped for userId=${userId}; scopes=${bootstrap.scopes.join(' ')} expiresOn=${bootstrap.expiresOn}`,
        );
      } catch (err) {
        console.error(`[HelkinSwarmBot] OBO bootstrap failed for userId=${userId}:`, err);
      }
    }

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

    // Dedup: Bot Connector may retry the same webhook POST within ~15s (#300).
    // activity.timestamp can differ between original and retry, so we use userId +
    // message text prefix only. TTL-based: same text from same user within 60s = dup.
    const dedupKey = createHash('sha256')
      .update(`${userId ?? 'anon'}:${messageText.slice(0, 200)}`)
      .digest('hex')
      .slice(0, 16);
    {
      const now = Date.now();
      const lastSeen = HelkinSwarmBot.recentActivityIds.get(dedupKey);
      if (lastSeen !== undefined && (now - lastSeen) < HelkinSwarmBot.DEDUP_TTL_MS) {
        console.info(`[HelkinSwarmBot] DEDUP-HIT in-memory key=${dedupKey} age=${now - lastSeen}ms — skipping`);
        return;
      }
      console.info(`[HelkinSwarmBot] DEDUP-PASS in-memory key=${dedupKey} lastSeen=${lastSeen ?? 'none'} mapSize=${HelkinSwarmBot.recentActivityIds.size}`);
      HelkinSwarmBot.recentActivityIds.set(dedupKey, now);
      // Prune expired entries to prevent unbounded growth
      if (HelkinSwarmBot.recentActivityIds.size > 100) {
        for (const [id, ts] of HelkinSwarmBot.recentActivityIds) {
          if (now - ts > HelkinSwarmBot.DEDUP_TTL_MS) {
            HelkinSwarmBot.recentActivityIds.delete(id);
          }
        }
      }
    }

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
    const inboundAssets = await ingestTeamsAttachments({
      userId,
      correlationId,
      conversationId: context.activity.conversation?.id ?? userId,
      messageId: context.activity.id,
      attachments: context.activity.attachments,
      htmlContent: this.extractInboundHtmlContent(context.activity),
      getBotToken: async () => getBearerToken('https://api.botframework.com/.default'),
      getGraphToken: async () => {
        const userGraphToken = await getGraphTokenForUser(userId).catch(() => undefined);
        if (userGraphToken) {
          return userGraphToken;
        }

        return await getBearerToken('https://graph.microsoft.com/.default').catch(() => undefined);
      },
    });

    if (isColdStarting()) {
      const coldStartDelayMs = Math.max(500, 3_500 - getContainerAgeMs());
      try {
        const conversationReference = TurnContextClass.getConversationReference(context.activity);
        const { trackingId, intent } = await createPendingIntent({
          userId,
          messageText,
          conversationReferenceJson: JSON.stringify(conversationReference),
          correlationId,
          imageUrls: inboundAssets.imageUrls,
          runtimeAssets: inboundAssets.runtimeAssets,
          attachmentNotices: inboundAssets.notices,
          creationReason: 'cold-start-wake-up',
          userNotified: true,
        });

        trackEvent({
          name: 'PolicyOverrideApplied',
          correlationId,
          userId,
          properties: {
            authority: 'cold-start-wake-up-queue',
            trackingId,
            containerAgeMs: getContainerAgeMs(),
            coldStartDelayMs,
          },
        });

        await context.sendActivity(
          `⏳ HelkinSwarm is waking up from scale-to-zero. I queued this exact message for automatic replay (tracking: ${trackingId}); you do not need to resend it.`,
        );

        if (this.durableClient) {
          void (async () => {
            await new Promise((resolve) => setTimeout(resolve, coldStartDelayMs));
            try {
              const replayResult = await replayPendingIntent(
                this.durableClient!,
                intent,
                'cold-start-wake-up',
              );
              if (replayResult.outcome !== 'replayed') {
                console.info(
                  `[HelkinSwarmBot] Cold-start wake-up replay ${replayResult.outcome} for ${trackingId}: ${replayResult.reason}`,
                );
              }
            } catch (err) {
              console.warn(
                `[HelkinSwarmBot] Cold-start wake-up replay failed for ${trackingId}: ${err instanceof Error ? err.message : err}`,
              );
            }
          })();
        }
      } catch (err) {
        console.warn(
          `[HelkinSwarmBot] Cold-start queueing failed: ${err instanceof Error ? err.message : err}`,
        );
        await context.sendActivity(
          '⏳ HelkinSwarm is still waking up, and I could not queue this message automatically. Please resend it in a few seconds.',
        );
      }
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

    // Auth code interception (#301): if the message looks like a Bot Framework magic
    // code (6-digit numeric or 32-char hex) and there's a pending /link challenge for
    // this user, intercept it before it reaches the overseer. No quoted-reply needed —
    // the user just pastes the code directly in the chat after clicking the sign-in link.
    // The challenge is looked up by userId only (not replyToId) so it survives Teams
    // message-reference format differences and is simpler for the user.
    const extractedAuthCode = extractBotFrameworkAuthCode(messageText);
    const pendingLinkChallenge = extractedAuthCode
      ? await getPendingLinkChallengeForUser(userId)
      : undefined;

    if (pendingLinkChallenge && extractedAuthCode) {
      const handled = await this.tryCompletePendingSkillLink(
        context,
        pendingLinkChallenge,
        extractedAuthCode,
      );
      if (handled) {
        return;
      }
    }

    // Slash commands are handled before routing to the overseer.
    if (lowerMessage === '/emergency-stop') {
      await this.handleEmergencyStop(context, userId);
      return;
    }

    if (lowerMessage === '/emergency-resume') {
      await this.handleEmergencyResume(context, userId);
      return;
    }

    if (lowerMessage.startsWith('/forge promote')) {
      await this.handleForgePromote(context, userId, messageText);
      return;
    }

    if (lowerMessage === '/validate-stale-ack' || lowerMessage === 'validate stale ack') {
      await this.handleValidateStaleAck(context, userId);
      return;
    }

    if (lowerMessage === '/assetreply selftest') {
      await this.handleAssetReplySelfTest(context, userId);
      return;
    }

    if (lowerMessage.startsWith('/assetingest selftest')) {
      await this.handleAssetIngestSelfTest(context, userId, userAlias, messageText);
      return;
    }

    if (lowerMessage === '/assetstore selftest') {
      await this.handleAssetStoreSelfTest(context, userId);
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

    // /skillSearch — read-only user-facing discovery over the installed skill/tool surface (#399)
    if (lowerMessage.startsWith('/skillsearch')) {
      const response = await renderSkillSearchCommandResponse(messageText);
      await context.sendActivity({
        type: ActivityTypes.Message,
        text: response,
        textFormat: 'markdown',
      });
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
      const consciousLane = getConsciousLaneAssessment();
      const modeLabel = health.enabled
        ? (health.source === 'emergency-stop' ? 'E-STOP' : 'MAINTENANCE')
        : 'OFF';
      await context.sendActivity(
        `HelkinSwarm ${version} — ` +
          `maintenance: ${modeLabel}, ` +
          `safety: ${safe}, ` +
          `tools: ${toolRegistry.size}, ` +
          `conscious-lane: ${consciousLane.deploymentName} (${consciousLane.capacityProfile.capacityLevel}, ${consciousLane.isImpaired ? 'impaired' : 'stable'}, ${consciousLane.capacityProfile.impairmentProtocol})`,
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

    const nativeEmojiEasterEggReply = await buildTeamsNativeEmojiEasterEggReply({
      messageText,
      activityText: context.activity.text ?? undefined,
      activityDetails: [
        JSON.stringify(context.activity),
        JSON.stringify(context.activity.entities ?? []),
        JSON.stringify(context.activity.channelData ?? {}),
        JSON.stringify(context.activity.attachments ?? []),
      ],
    });
    if (nativeEmojiEasterEggReply) {
      if (nativeEmojiEasterEggReply.kind === 'robot-love') {
        const inlineResponse = await context.sendActivity({
          type: ActivityTypes.Message,
          ...(nativeEmojiEasterEggReply.text ? { text: nativeEmojiEasterEggReply.text } : {}),
          ...(nativeEmojiEasterEggReply.textFormat ? { textFormat: nativeEmojiEasterEggReply.textFormat } : {}),
          ...(nativeEmojiEasterEggReply.attachments ? { attachments: nativeEmojiEasterEggReply.attachments } : {}),
        });

        if (nativeEmojiEasterEggReply.attachments?.[0]?.name === 'RobotLove.gif') {
          await this.offerRobotLoveAnimationFile(
            context,
            userId,
            correlationId,
            nativeEmojiEasterEggReply.attachments[0].contentUrl,
            inlineResponse?.id,
          );
        }
        return;
      }

      await context.sendActivity({
        type: ActivityTypes.Message,
        ...(nativeEmojiEasterEggReply.text ? { text: nativeEmojiEasterEggReply.text } : {}),
        ...(nativeEmojiEasterEggReply.textFormat ? { textFormat: nativeEmojiEasterEggReply.textFormat } : {}),
        ...(nativeEmojiEasterEggReply.attachments ? { attachments: nativeEmojiEasterEggReply.attachments } : {}),
      });
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
    const textForShieldsBase = devLoopParsed.isDevLoop ? devLoopParsed.body : messageText;
    const textForShields = isReadOnlyDiscoveryRequest(textForShieldsBase)
      ? buildReadOnlyDiscoveryQuery(textForShieldsBase)
      : textForShieldsBase;

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
    const existingOverseerInstanceId = await this.findExistingOverseerInstance(
      userId,
      messageText,
      undefined,
      undefined,
      context.activity.id,
    );
    if (existingOverseerInstanceId) {
      console.info(
        `[HelkinSwarmBot] Duplicate inbound activity suppressed before ack: ${existingOverseerInstanceId}`,
      );
      return;
    }

    const correlationTag = correlationId.slice(0, 8);
    const ackResponse = await context.sendActivity(getCorrelatedAck(correlationTag));
    if (ackResponse?.id) {
      const conversationId = context.activity.conversation?.id ?? userId;
      await savePendingAckId(userId, conversationId, ackResponse.id, correlationId);
    }

    const devLoopCtx = devLoopParsed.isDevLoop ? {
      isDevLoop: devLoopParsed.isDevLoop,
      prefix: devLoopParsed.prefix,
      correlationTag: devLoopParsed.correlationTag,
      body: devLoopParsed.body,
      hasOver: devLoopParsed.hasOver,
    } : undefined;

    try {
      const result = await this.raiseToOverseer(
        context,
        userId,
        userAlias,
        messageText,
        undefined,
        inboundAssets.imageUrls,
        inboundAssets.runtimeAssets,
        inboundAssets.notices,
        devLoopCtx,
        correlationTag,
        quotedContext,
        correlationId,
        undefined,
        context.activity.id,
      );
      await this.handleRaiseToOverseerResult(context, userId, correlationId, ackResponse?.id, result);
    } catch (err) {
      // Overseer unreachable — persist as pending intent for startup recovery (#116)
      const conversationReference = TurnContextClass.getConversationReference(context.activity);
      const failureReason = err instanceof Error ? err.message : String(err);
      const { trackingId } = await createPendingIntent({
        userId,
        messageText,
        conversationReferenceJson: JSON.stringify(conversationReference),
        correlationId,
          imageUrls: inboundAssets.imageUrls,
          runtimeAssets: inboundAssets.runtimeAssets,
          attachmentNotices: inboundAssets.notices,
        devLoopContextJson: devLoopCtx ? JSON.stringify(devLoopCtx) : undefined,
        failureReason,
      });
      await context.sendActivity(
        `⏳ Your message has been queued (tracking: ${trackingId}). I'll process it when I'm back online.`,
      );
      console.error(`[HelkinSwarmBot] Queued pending intent ${trackingId}: ${failureReason}`);
    }
  }

  /** Route a user message to a fresh one-shot overseer instance (#280). */
  private async findExistingOverseerInstance(
    userId: string,
    userMessage: string,
    modelOverride?: string,
    skillForgeRequest?: NewMessageEvent['skillForgeRequest'],
    messageId?: string,
  ): Promise<string | undefined> {
    const client = this.durableClient;
    if (!client) {
      return undefined;
    }

    const identity = buildOverseerDedupIdentity({
      userId,
      userMessage,
      modelOverride,
      skillForgeRequest,
      messageId,
    });

    for (const iid of [identity.instanceId, identity.previousInstanceId]) {
      try {
        const existing = await client.getStatus(iid);
        if (existing?.runtimeStatus !== undefined && existing.runtimeStatus !== null) {
          console.info(
            `[HelkinSwarmBot] DEDUP-HIT durable iid=${iid} status=${String(existing.runtimeStatus)} bucket=${identity.timeBucket} — skipping`,
          );
          return iid;
        }
        console.info(`[HelkinSwarmBot] DEDUP getStatus iid=${iid} status=${existing?.runtimeStatus ?? 'null/undefined'}`);
      } catch {
        console.info(`[HelkinSwarmBot] DEDUP getStatus iid=${iid} threw (not found)`);
      }
    }

    return undefined;
  }

  private async suppressDuplicateAck(
    context: TurnContext,
    userId: string,
    correlationId: string,
    ackActivityId: string,
  ): Promise<void> {
    const conversationId = context.activity.conversation?.id ?? userId;
    try {
      await context.updateActivity({
        type: ActivityTypes.Message,
        id: ackActivityId,
        text: '↩️ Duplicate Teams delivery suppressed — the original turn is already being handled.',
        textFormat: 'markdown',
      });
    } catch (err) {
      console.warn('[HelkinSwarmBot] Failed to update duplicate ack placeholder:', err);
    } finally {
      await clearPendingAckId(conversationId, correlationId);
    }
  }

  private async replaceAckWithQueuedNotice(
    context: TurnContext,
    userId: string,
    correlationId: string,
    ackActivityId: string,
    trackingId: string,
  ): Promise<void> {
    const conversationId = context.activity.conversation?.id ?? userId;
    try {
      await context.updateActivity({
        type: ActivityTypes.Message,
        id: ackActivityId,
        text: `⏳ I already have active work in flight, so I queued this turn (tracking: ${trackingId}). I'll process it when I'm back online.`,
        textFormat: 'markdown',
      });
    } catch (err) {
      console.warn('[HelkinSwarmBot] Failed to update queued ack placeholder:', err);
      await context.sendActivity(
        `⏳ I already have active work in flight, so I queued this turn (tracking: ${trackingId}). I'll process it when I'm back online.`,
      );
    } finally {
      await clearPendingAckId(conversationId, correlationId);
    }
  }

  private async replaceAckWithDeferredNotice(
    context: TurnContext,
    userId: string,
    correlationId: string,
    ackActivityId: string,
    trackingId: string,
  ): Promise<void> {
    const conversationId = context.activity.conversation?.id ?? userId;
    const text = `⚠️ I’m currently on a low-capacity conscious lane, so I deferred this heavier turn (tracking: ${trackingId}). I’ll keep it queued for later recovery, or you can retry with /heavy for full reasoning.`;
    try {
      await context.updateActivity({
        type: ActivityTypes.Message,
        id: ackActivityId,
        text,
        textFormat: 'markdown',
      });
    } catch (err) {
      console.warn('[HelkinSwarmBot] Failed to update deferred ack placeholder:', err);
      await context.sendActivity(text);
    } finally {
      await clearPendingAckId(conversationId, correlationId);
    }
  }

  private async replaceAckWithCommandFailureNotice(
    context: TurnContext,
    userId: string,
    correlationId: string,
    ackActivityId: string,
    text: string,
  ): Promise<void> {
    const conversationId = context.activity.conversation?.id ?? userId;
    try {
      await context.updateActivity({
        type: ActivityTypes.Message,
        id: ackActivityId,
        text,
        textFormat: 'markdown',
      });
    } catch (err) {
      console.warn('[HelkinSwarmBot] Failed to update command-failure ack placeholder:', err);
      await context.sendActivity(text);
    } finally {
      await clearPendingAckId(conversationId, correlationId);
    }
  }

  private async handleRaiseToOverseerResult(
    context: TurnContext,
    userId: string,
    correlationId: string,
    ackActivityId: string | undefined,
    result: RaiseToOverseerResult,
  ): Promise<void> {
    if (!ackActivityId) {
      return;
    }

    if (result.outcome === 'duplicate') {
      await this.suppressDuplicateAck(context, userId, correlationId, ackActivityId);
      return;
    }

    if (result.outcome === 'queued') {
      await this.replaceAckWithQueuedNotice(context, userId, correlationId, ackActivityId, result.trackingId);
      return;
    }

    if (result.outcome === 'deferred') {
      await this.replaceAckWithDeferredNotice(context, userId, correlationId, ackActivityId, result.trackingId);
    }
  }

  private async raiseToOverseer(
    context: TurnContext,
    userId: string,
    userAlias: string,
    userMessage: string,
    modelOverride?: string,
    imageUrls?: string[],
    runtimeAssets?: NewMessageEvent['runtimeAssets'],
    attachmentNotices?: string[],
    devLoopContext?: NewMessageEvent['devLoopContext'],
    correlationTag?: string,
    quotedContext?: QuotedContext,
    correlationId?: string,
    skillForgeRequest?: NewMessageEvent['skillForgeRequest'],
    messageId?: string,
  ): Promise<RaiseToOverseerResult> {
    const client = this.durableClient!;
    const eventCorrelationId = correlationId ?? crypto.randomUUID();

    // One-shot pattern: each message gets a unique overseer instance.
    // This avoids Azure Storage history accumulation (#280) — purgeInstanceHistory
    // does NOT delete history events from the History table, so reusing the same
    // instanceId causes unbounded replay growth.
    //
    // Dedup (#300): use a wall-clock 60s time bucket + userId + text prefix to create
    // a deterministic instanceId. activity.timestamp can differ between original POST
    // and Bot Connector retry, so we use server-side Date.now() in 60s buckets.
    // We check both current and previous bucket to handle boundary crossings.
    // Include routing discriminators (e.g. /light vs default, SkillForge) so two
    // intentionally different turns with the same prompt body do not collide.
    const identity = buildOverseerDedupIdentity({
      userId,
      userMessage,
      modelOverride,
      skillForgeRequest,
      messageId,
    });

    const conversationReference = TurnContextClass.getConversationReference(
      context.activity,
    );
    await saveConversationReference(userId, conversationReference);

    const event: NewMessageEvent = {
      userMessage,
      conversationReference,
      userId,
      userAlias,
      ...(skillForgeRequest !== undefined ? { skillForgeRequest } : {}),
      correlationId: eventCorrelationId,
      ...(modelOverride !== undefined ? { modelOverride } : {}),
      ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
      ...(runtimeAssets && runtimeAssets.length > 0 ? { runtimeAssets } : {}),
      ...(attachmentNotices && attachmentNotices.length > 0 ? { attachmentNotices } : {}),
      ...(devLoopContext !== undefined ? { devLoopContext } : {}),
      ...(correlationTag !== undefined ? { correlationTag } : {}),
      ...(quotedContext !== undefined ? { quotedContext } : {}),
    };

    try {
      // Check if this instance already exists (running OR completed) — prevents
      // duplicates when the retry arrives after the first overseer completed (#300).
      // Check both current and previous time bucket to handle 60s-boundary crossings.
      // getStatus may throw 404 for non-existent instances — that's expected.
      const existingInstanceId = await this.findExistingOverseerInstance(
        userId,
        userMessage,
        modelOverride,
        skillForgeRequest,
        messageId,
      );
      if (existingInstanceId) return { outcome: 'duplicate' };

      const guardState = await readMindSessionGuardState(client, userId);
      const activeSummary = await resolveActiveOverseerSummary(client, userId);
      const activeTurnCount = await getActiveTurnCountForUser(userId);
      const activeTurnEntries = await getActiveTurnStagesForUser(userId);
      const observedActiveInstanceId = activeSummary.latestInstanceId;
      const effectiveActiveInstanceId = observedActiveInstanceId ?? (activeTurnCount > 0 ? guardState?.activeInstanceId : undefined);
      const hasActiveGuard = activeTurnCount > 0 && effectiveActiveInstanceId !== identity.instanceId;
      const activeSessionRoutable = hasActiveGuard
        && effectiveActiveInstanceId !== undefined
        && activeTurnEntries.some((entry) => entry.stage === 'awaiting-ingress' && entry.instanceId === effectiveActiveInstanceId);
      const interruptionDepth = Math.max(
        guardState?.interruptionDepth ?? 0,
        Math.max(0, activeTurnCount - 1),
      );
      const consciousLane = getConsciousLaneAssessmentForTurn(modelOverride);
      const requestedTaskComplexity = classifyRequestedTaskComplexity({
        userMessage,
        modelOverride,
        runtimeAssetCount: runtimeAssets?.length ?? 0,
        hasQuotedContext: quotedContext !== undefined,
        hasDevLoopContext: devLoopContext !== undefined,
      });

      const ingressDecision = recordLimbicIngressDecision({
        source: 'teams-message',
        userId,
        correlationId: eventCorrelationId,
        compatibilityMode: getEnvConfig().livingMindCompatibilityMode,
        hasActiveSession: hasActiveGuard,
        activeSessionRoutable,
        interruptionDepth,
        interruptionDepthCap: MAX_INTERRUPTION_DEPTH,
        consciousModelImpaired: consciousLane.isImpaired,
        requestedTaskComplexity,
      });

      if (ingressDecision.decision === 'queue' || ingressDecision.decision === 'defer') {
        const creationReason = ingressDecision.decision === 'defer'
          ? 'conscious-lane-impaired'
          : interruptionDepth >= MAX_INTERRUPTION_DEPTH
            ? 'interruption-depth-cap'
            : 'single-session-enforcement';
        const { trackingId } = await createPendingIntent({
          userId,
          messageText: userMessage,
          conversationReferenceJson: JSON.stringify(conversationReference),
          modelOverride,
          devLoopContextJson: devLoopContext ? JSON.stringify(devLoopContext) : undefined,
          imageUrls,
          runtimeAssets,
          attachmentNotices,
          correlationId: eventCorrelationId,
          creationReason,
          userNotified: true,
          failureReason: ingressDecision.reason,
        });

        return {
          outcome: ingressDecision.decision === 'defer' ? 'deferred' : 'queued',
          trackingId,
          reason: ingressDecision.reason,
        };
      }

      if (activeSessionRoutable && effectiveActiveInstanceId) {
        trackEvent({
          name: 'PolicyOverrideApplied',
          correlationId: eventCorrelationId,
          userId,
          properties: {
            authority: 'living-session-awaiting-ingress-redirection',
            source: 'teams-message',
            activeInstanceId: effectiveActiveInstanceId,
            requestedInstanceId: identity.instanceId,
            interruptionDepth,
          },
        });

        await client.raiseEvent(effectiveActiveInstanceId, 'NewMessage', event);
        return { outcome: 'started' };
      }

      console.info(`[HelkinSwarmBot] DEDUP-PASS durable — starting ${identity.instanceId} bucket=${identity.timeBucket}`);
      await client.startNew('overseer', { instanceId: identity.instanceId, input: event });
      await signalMindSessionAcquire(client, userId, {
        instanceId: identity.instanceId,
        correlationId: eventCorrelationId,
        source: 'teams-message',
      });
      return { outcome: 'started' };
    } catch (err: unknown) {
      // 409 = instance already exists (race condition) — safe to ignore (#300)
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('409') || msg.includes('already exists') || msg.includes('conflict')) {
        console.info(`[HelkinSwarmBot] Duplicate overseer ${identity.instanceId} — skipping (Teams retry dedup)`);
        return { outcome: 'duplicate' };
      }
      throw err;
    }
  }

  /** /forge <idea> — SkillForge entry point (owner-only). */
  private async handleForge(
    context: TurnContext,
    userId: string,
    userAlias: string,
    messageText: string,
  ): Promise<void> {
    if (!this.durableClient) {
      await context.sendActivity('Internal error: orchestrator client not available. Please try again.');
      return;
    }

    try {
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

      const correlationId = crypto.randomUUID();
      const existingOverseerInstanceId = await this.findExistingOverseerInstance(
        userId,
        idea,
        undefined,
        { idea },
        context.activity.id,
      );
      if (existingOverseerInstanceId) {
        console.info(`[HelkinSwarmBot] Duplicate /forge request suppressed before ack: ${existingOverseerInstanceId}`);
        return;
      }

      const ackResponse = await context.sendActivity('⌛ Working on it... (⚙️ SkillForge)');
      if (ackResponse?.id) {
        const conversationId = context.activity.conversation?.id ?? userId;
        await savePendingAckId(userId, conversationId, ackResponse.id, correlationId);
      }

      const result = await this.raiseToOverseer(
        context,
        userId,
        userAlias,
        idea,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        correlationId,
        { idea },
        context.activity.id,
      );
      await this.handleRaiseToOverseerResult(context, userId, correlationId, ackResponse?.id, result);
    } catch (err) {
      console.error(`[HelkinSwarmBot] /forge failed before handoff: ${err instanceof Error ? err.message : err}`);
      await context.sendActivity({
        type: ActivityTypes.Message,
        text: '⚠️ SkillForge failed before it could start. Please try again in a moment.',
        textFormat: 'markdown',
      });
    }
  }

  /** /forge promote <bundlePath> — owner-approved promotion of a persisted SkillForge bundle into tracked repo files. */
  private async handleForgePromote(
    context: TurnContext,
    userId: string,
    messageText: string,
  ): Promise<void> {
    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    const bundlePath = messageText.slice('/forge promote'.length).trim();
    if (!bundlePath) {
      await context.sendActivity('Usage: /forge promote <persisted-bundle-path>');
      return;
    }

    const ack = await context.sendActivity('⌛ Promoting SkillForge bundle into tracked repository files...');

    try {
      const result = await promoteSkillForgeBundle(bundlePath);
      const ackId = ack?.id;
      const uniqueCommitShas = [...new Set(result.fileResults.map((file) => file.commitSha).filter(Boolean))];
      const promotionMessage = result.status === 'promoted'
        ? [
            `✅ Promoted **${result.skillId}** from persisted bundle to \`${result.branch}\`.`,
            '',
            `Bundle: \`${result.bundlePath}\``,
            `Commit message: \`${result.commitMessage}\``,
            uniqueCommitShas.length > 0
              ? `Commit SHA${uniqueCommitShas.length > 1 ? 's' : ''}: ${uniqueCommitShas.map((sha) => `\`${sha}\``).join(', ')}`
              : 'Commit SHA: unavailable',
            '',
            'Files:',
            ...result.fileResults.map((file) => `- \`${file.path}\` (${file.action})`),
            '',
            `Local reload summary: ${result.reloadSummary.skillsLoaded} skills / ${result.reloadSummary.toolsRegistered} tools registered in the current stamp process.`,
            'Repo push to `main` has been made; deployment will rebuild the stamp so the promoted skill becomes executable from tracked source.',
          ].join('\n')
        : [
            `⚠️ GitHub promotion is blocked for **${result.skillId}**, but the reviewed bundle is ready for owner-side promotion.`,
            '',
            `Bundle: \`${result.bundlePath}\``,
            `Intended branch: \`${result.branch}\``,
            `Intended commit message: \`${result.commitMessage}\``,
            result.fallbackReason ?? 'GitHub App repository contents access is unavailable on this stamp.',
            '',
            'Prepared files:',
            ...result.fileResults.map((file) => `- \`${file.path}\``),
            '',
            'Next steps:',
            ...(result.nextSteps ?? []).map((step, index) => `${index + 1}. ${step}`),
            '',
            'No repository files were changed by this bot command.',
          ].join('\n');

      if (ackId) {
        await context.updateActivity({
          type: ActivityTypes.Message,
          id: ackId,
          text: promotionMessage,
          textFormat: 'markdown',
        });
      } else {
        await context.sendActivity({ type: ActivityTypes.Message, text: promotionMessage, textFormat: 'markdown' });
      }
    } catch (err) {
      const errorMessage = `⚠️ SkillForge promotion failed: ${err instanceof Error ? err.message : String(err)}`;
      if (ack?.id) {
        await context.updateActivity({
          type: ActivityTypes.Message,
          id: ack.id,
          text: errorMessage,
          textFormat: 'markdown',
        });
      } else {
        await context.sendActivity(errorMessage);
      }
    }
  }

  private async offerRobotLoveAnimationFile(
    context: TurnContext,
    userId: string,
    correlationId: string,
    dataUrl: string,
    inlineMessageId?: string,
  ): Promise<void> {
    const parsed = /^data:(?<contentType>[^;]+);base64,(?<payload>.+)$/u.exec(dataUrl);
    if (!parsed?.groups?.contentType || !parsed.groups.payload) {
      return;
    }

    const persisted = await persistRuntimeAsset({
      userId,
      correlationId,
      bytes: Buffer.from(parsed.groups.payload, 'base64'),
      contentType: parsed.groups.contentType,
      fileName: 'RobotLove.gif',
      source: {
        channel: 'system',
        toolName: 'robotlove-easter-egg',
        detail: 'Animated RobotLove easter egg file handoff for Teams clients that render bot GIF previews as still images.',
      },
      summary: 'Animated RobotLove easter egg GIF.',
    });

    if (!persisted) {
      return;
    }

    const consentContext = RuntimeFileConsentContextSchema.parse({
      assetId: persisted.id,
      userId,
      correlationId,
      fileName: 'RobotLove.gif',
      contentType: persisted.contentType,
    });

    await context.sendActivity({
      type: ActivityTypes.Message,
      text: inlineMessageId
        ? '🤖❤️👀 Teams bot image previews are static, so tap below if you want the full animated `RobotLove.gif`.'
        : '🤖❤️👀 Tap below if you want the full animated `RobotLove.gif`.',
      textFormat: 'markdown',
      attachments: [{
        contentType: 'application/vnd.microsoft.teams.card.file.consent',
        name: 'RobotLove.gif',
        content: {
          description: 'Download the full animated RobotLove.gif easter egg.',
          sizeInBytes: persisted.byteLength,
          acceptContext: consentContext,
          declineContext: consentContext,
        },
      }],
    });
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
    const correlationId = crypto.randomUUID();
    const existingOverseerInstanceId = await this.findExistingOverseerInstance(
      userId,
      prompt,
      modelOverride,
      undefined,
      context.activity.id,
    );
    if (existingOverseerInstanceId) {
      console.info(`[HelkinSwarmBot] Duplicate ${modelOverride} override request suppressed before ack: ${existingOverseerInstanceId}`);
      return;
    }

    const ackResponse = await context.sendActivity(`⌛ Working on it... (${label})`);
    try {
      if (ackResponse?.id) {
        const conversationId = context.activity.conversation?.id ?? userId;
        await savePendingAckId(userId, conversationId, ackResponse.id, correlationId);
      }
      const result = await this.raiseToOverseer(
        context,
        userId,
        userAlias,
        prompt,
        modelOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        correlationId,
        undefined,
        context.activity.id,
      );
      await this.handleRaiseToOverseerResult(context, userId, correlationId, ackResponse?.id, result);
    } catch (err) {
      console.error(`[HelkinSwarmBot] ${modelOverride} override handoff failed for correlationId=${correlationId}:`, err);
      if (ackResponse?.id) {
        await this.replaceAckWithCommandFailureNotice(
          context,
          userId,
          correlationId,
          ackResponse.id,
          '⚠️ This forced-model turn failed before it reached the living session. Please retry.',
        );
      } else {
        await context.sendActivity('⚠️ This forced-model turn failed before it reached the living session. Please retry.');
      }
    }
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

    const correlationId = crypto.randomUUID();
    const existingOverseerInstanceId = await this.findExistingOverseerInstance(
      userId,
      prompt,
      deploymentName,
      undefined,
      context.activity.id,
    );
    if (existingOverseerInstanceId) {
      console.info(`[HelkinSwarmBot] Duplicate /model request suppressed before ack: ${existingOverseerInstanceId}`);
      return;
    }

    const ackResponse = await context.sendActivity(`⌛ Working on it... (🎯 ${deploymentName})`);
    try {
      if (ackResponse?.id) {
        const conversationId = context.activity.conversation?.id ?? userId;
        await savePendingAckId(userId, conversationId, ackResponse.id, correlationId);
      }
      const result = await this.raiseToOverseer(
        context,
        userId,
        userAlias,
        prompt,
        deploymentName,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        correlationId,
        undefined,
        context.activity.id,
      );
      await this.handleRaiseToOverseerResult(context, userId, correlationId, ackResponse?.id, result);
    } catch (err) {
      console.error(`[HelkinSwarmBot] direct model override handoff failed for correlationId=${correlationId} deployment=${deploymentName}:`, err);
      if (ackResponse?.id) {
        await this.replaceAckWithCommandFailureNotice(
          context,
          userId,
          correlationId,
          ackResponse.id,
          '⚠️ This direct-model turn failed before it reached the living session. Please retry.',
        );
      } else {
        await context.sendActivity('⚠️ This direct-model turn failed before it reached the living session. Please retry.');
      }
    }
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

      await clearOrchestratorStagesForInstanceIds(
        terminationTargets.map((status) => status.instanceId),
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
   * /validate-stale-ack — owner-only validation seam for #383/#373.
   * Creates a real visible placeholder, backdates it past the watchdog threshold,
   * then runs the same stale-ack recovery scan used by the timer/startup path.
   */
  private async handleValidateStaleAck(
    context: TurnContext,
    userId: string,
  ): Promise<void> {
    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    const correlationId = crypto.randomUUID();
    const ackResponse = await context.sendActivity('⌛ Working on it... (🧪 stale-ack validation)');

    if (!ackResponse?.id) {
      await context.sendActivity('⚠️ Validation failed before the placeholder could be created.');
      return;
    }

    const conversationId = context.activity.conversation?.id ?? userId;
    const conversationReference = TurnContextClass.getConversationReference(context.activity);

    // Leave the placeholder visible briefly, then trigger the same in-place
    // recovery updater the watchdog uses after the handler has returned.
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, STALE_ACK_VALIDATION_DELAY_MS));
      try {
        await recoverStaleAck(
          conversationId,
          ackResponse.id,
          userId,
          correlationId,
          conversationReference,
        );
      } catch (err) {
        console.warn('[HelkinSwarmBot] /validate-stale-ack recovery failed:', err);
      }
    })();
  }

  /**
   * /assetstore selftest — owner-only runtime asset storage validation seam for #417.
   * Persists a tiny text asset, resolves metadata, downloads bytes, and deletes it again.
   */
  private async handleAssetStoreSelfTest(
    context: TurnContext,
    userId: string,
  ): Promise<void> {
    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    const ack = await context.sendActivity('⌛ Running runtime asset storage self-test...');
    const correlationId = crypto.randomUUID();

    try {
      const bytes = Buffer.from('HelkinSwarm runtime asset self-test', 'utf8');
      const reference = await persistRuntimeAsset({
        userId,
        correlationId,
        bytes,
        contentType: 'text/plain',
        fileName: 'runtime-asset-selftest.txt',
        source: {
          channel: 'system',
          toolName: 'assetstore-selftest',
          detail: 'Owner-triggered runtime asset storage validation.',
        },
        summary: 'Owner-triggered runtime asset store validation blob.',
      });

      if (!reference) {
        throw new Error('Runtime asset storage is not configured on this stamp.');
      }

      const loadedReference = await loadRuntimeAssetReference(reference);
      const loadedContent = await readRuntimeAssetContent(reference);
      const deleted = await deleteRuntimeAsset(reference);

      if (!loadedReference || !loadedContent) {
        throw new Error('Persisted asset could not be resolved/read back.');
      }

      const reply = [
        '✅ Runtime asset store self-test passed.',
        '',
        `Asset ID: \`${reference.id}\``,
        `Content type: \`${reference.contentType}\``,
        `Filename: \`${reference.fileName ?? 'n/a'}\``,
        `Bytes: ${loadedContent.content.byteLength}`,
        `Expires: ${reference.expiresAt}`,
        `Deleted after verification: ${deleted ? 'yes' : 'no'}`,
        '',
        buildRuntimeAssetPromptSummary(reference),
      ].join('\n');

      if (ack?.id) {
        await context.updateActivity({
          type: ActivityTypes.Message,
          id: ack.id,
          text: reply,
          textFormat: 'markdown',
        });
      } else {
        await context.sendActivity(reply);
      }
    } catch (err) {
      const message = `⚠️ Runtime asset store self-test failed: ${err instanceof Error ? err.message : String(err)}`;
      if (ack?.id) {
        await context.updateActivity({
          type: ActivityTypes.Message,
          id: ack.id,
          text: message,
          textFormat: 'markdown',
        });
      } else {
        await context.sendActivity(message);
      }
    }
  }

  /**
   * /assetreply selftest — owner-only validation seam for #419.
   * Persists one tiny image asset and one tiny text asset, then sends them back
   * through sendReply so the real outbound attachment reply path is exercised.
   */
  private async handleAssetReplySelfTest(
    context: TurnContext,
    userId: string,
  ): Promise<void> {
    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    const correlationId = crypto.randomUUID();
    const ackResponse = await context.sendActivity('⌛ Running outbound asset reply self-test...');
    if (ackResponse?.id) {
      const conversationId = context.activity.conversation?.id ?? userId;
      await savePendingAckId(userId, conversationId, ackResponse.id, correlationId);
    }

    const conversationReference = TurnContextClass.getConversationReference(context.activity);
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2l9wAAAABJRU5ErkJggg==',
      'base64',
    );
    const textBytes = Buffer.from('HelkinSwarm outbound asset reply self-test', 'utf8');

    try {
      const imageReference = await persistRuntimeAsset({
        userId,
        correlationId,
        bytes: pngBytes,
        contentType: 'image/png',
        fileName: 'asset-reply-selftest.png',
        source: {
          channel: 'system',
          toolName: 'assetreply-selftest',
          detail: 'Owner-triggered outbound image attachment reply validation.',
        },
        summary: '1x1 PNG for outbound Teams attachment reply validation.',
      });
      const textReference = await persistRuntimeAsset({
        userId,
        correlationId,
        bytes: textBytes,
        contentType: 'text/plain',
        fileName: 'asset-reply-selftest.txt',
        source: {
          channel: 'system',
          toolName: 'assetreply-selftest',
          detail: 'Owner-triggered outbound file attachment reply validation.',
        },
        summary: 'Plain-text file for outbound Teams attachment reply validation.',
      });

      if (!imageReference || !textReference) {
        throw new Error('Runtime asset storage is not configured on this stamp.');
      }

      await sendReply({
        userId,
        correlationId,
        conversationReference,
        message: [
          '✅ Outbound asset reply self-test passed.',
          '',
          `Image asset: \`${imageReference.fileName}\` (${imageReference.contentType})`,
          `File asset: \`${textReference.fileName}\` (${textReference.contentType})`,
          'Attachments are sent via the real sendReply pipeline from runtime asset references.',
        ].join('\n'),
        assets: [
          { assetId: imageReference.id },
          { assetId: textReference.id },
        ],
      });
    } catch (err) {
      const message = `⚠️ Outbound asset reply self-test failed: ${err instanceof Error ? err.message : String(err)}`;
      if (ackResponse?.id) {
        await context.updateActivity({
          type: ActivityTypes.Message,
          id: ackResponse.id,
          text: message,
          textFormat: 'markdown',
        });
      } else {
        await context.sendActivity(message);
      }
    }
  }

  /**
   * /assetingest selftest [primary|secondary] — owner-only live seam for #416.
   * Exercises the inbound attachment ingestion helper with synthetic Teams-style
   * attachments, then routes the ingested runtime assets through the normal
   * overseer/LLM reply path on the requested model lane.
   */
  private async handleAssetIngestSelfTest(
    context: TurnContext,
    userId: string,
    userAlias: string,
    messageText: string,
  ): Promise<void> {
    if (!(await isOwnerUserId(userId))) {
      await context.sendActivity('⛔ Owner-only command.');
      return;
    }

    const rawArgs = messageText.trim().split(/\s+/).slice(2);
    let modelOverride: 'primary' | 'secondary' | undefined;
    let inlineEmailMode = false;
    let inlineEmailRecipient: string | undefined;

    for (const arg of rawArgs) {
      const normalizedArg = arg.toLowerCase();
      if ((normalizedArg === 'primary' || normalizedArg === 'secondary') && !modelOverride) {
        modelOverride = normalizedArg;
        continue;
      }

      if (normalizedArg === 'inline-email') {
        inlineEmailMode = true;
        continue;
      }

      if (inlineEmailMode && !inlineEmailRecipient) {
        inlineEmailRecipient = arg;
        continue;
      }

      await context.sendActivity('Usage: `/assetingest selftest [primary|secondary]` or `/assetingest selftest inline-email <recipient> [primary|secondary]`');
      return;
    }

    if (inlineEmailMode && !inlineEmailRecipient) {
      await context.sendActivity('Usage: `/assetingest selftest inline-email <recipient> [primary|secondary]`');
      return;
    }

    const correlationId = crypto.randomUUID();
    const laneLabel = modelOverride ? ` (${modelOverride})` : '';
    const inlineEmailContentId = 'asset-ingest-selftest';
    const inlineEmailSubject = `DL-inline-selftest-${correlationId.slice(0, 8)}`;
    const assetIngestPrompt = inlineEmailMode
      ? [
          'Use the exact tool outlook_send_email.',
          `Send an HTML email to ${inlineEmailRecipient} with subject "${inlineEmailSubject}".`,
          `The body must contain a short intro paragraph plus an inline image using <img src="cid:${inlineEmailContentId}" />.`,
          `Use the runtime asset for \`asset-ingest-selftest.png\` as inlineAssets with contentId \`${inlineEmailContentId}\`.`,
          'Do not use the text asset as an attachment for this test.',
          'After the tool call, tell me plainly whether the email was actually sent.',
        ].join(' ')
      : 'For this inbound attachment ingestion self-test, report the runtime assets available in this turn. List each filename, content type, attachment kind, and asset ID in short bullets, and say whether any attachment ingestion notices were present.';
    const existingOverseerInstanceId = await this.findExistingOverseerInstance(
      userId,
      assetIngestPrompt,
      modelOverride,
      undefined,
      context.activity.id,
    );
    if (existingOverseerInstanceId) {
      console.info(`[HelkinSwarmBot] Duplicate /assetingest selftest suppressed before ack: ${existingOverseerInstanceId}`);
      return;
    }

    const ackLabel = inlineEmailMode
      ? `⌛ Running inbound asset inline-email self-test${laneLabel}...`
      : `⌛ Running inbound asset ingestion self-test${laneLabel}...`;
    const ackResponse = await context.sendActivity(ackLabel);
    if (ackResponse?.id) {
      const conversationId = context.activity.conversation?.id ?? userId;
      await savePendingAckId(userId, conversationId, ackResponse.id, correlationId);
    }

    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2l9wAAAABJRU5ErkJggg==';
    const textDataUrl = `data:text/plain;base64,${Buffer.from('HelkinSwarm inbound asset ingestion self-test', 'utf8').toString('base64')}`;

    try {
      const ingested = await ingestTeamsAttachments({
        userId,
        correlationId,
        conversationId: context.activity.conversation?.id ?? userId,
        messageId: context.activity.id,
        attachments: [
          {
            contentType: 'image/png',
            contentUrl: pngDataUrl,
            name: 'asset-ingest-selftest.png',
          },
          {
            contentType: 'application/vnd.microsoft.teams.file.download.info',
            name: 'asset-ingest-selftest.txt',
            content: {
              downloadUrl: textDataUrl,
              uniqueId: crypto.randomUUID(),
              fileType: 'txt',
              etag: 'selftest',
            },
          },
        ],
      });

      if (ingested.runtimeAssets.length < 2) {
        throw new Error(`Expected 2 runtime assets, got ${ingested.runtimeAssets.length}.`);
      }

      // This self-test validates inbound attachment ingestion + runtime asset
      // propagation. For inline-email mode, the lane under test must see the
      // runtime asset references (including asset IDs) so it can call
      // outlook_send_email with inlineAssets on the real deployed path.
      const result = await this.raiseToOverseer(
        context,
        userId,
        userAlias,
        assetIngestPrompt,
        modelOverride,
        undefined,
        ingested.runtimeAssets,
        ingested.notices,
        undefined,
        undefined,
        undefined,
        correlationId,
        undefined,
        context.activity.id,
      );
      await this.handleRaiseToOverseerResult(context, userId, correlationId, ackResponse?.id, result);
    } catch (err) {
      const message = `⚠️ Inbound asset ingestion self-test failed: ${err instanceof Error ? err.message : String(err)}`;
      if (ackResponse?.id) {
        await context.updateActivity({
          type: ActivityTypes.Message,
          id: ackResponse.id,
          text: message,
          textFormat: 'markdown',
        });
      } else {
        await context.sendActivity(message);
      }
    }
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
      const existingToken = await checkUserTokenForTurnContext(context, connectionName);
      if (existingToken) {
        await context.sendActivity(`✅ **${manifest.domain}** is linked.`);
      } else {
        await context.sendActivity(
          `❌ **${manifest.domain}** is not linked. Use \`/link ${manifest.domain}\` to connect.`,
        );
      }
      return;
    }

    // /link <skill> — initiate OAuth
    const channelUserId = context.activity.from.id;
    const channelId = context.activity.channelId ?? '';
    const existingToken = await checkUserTokenForTurnContext(context, connectionName);

    if (existingToken) {
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
    const sentActivityId = await this.sendFreshMessage(context, { attachments: [card] });
    const userId = context.activity.from.aadObjectId;
    if (userId && sentActivityId) {
      await registerPendingLinkChallenge({
        userId,
        skillDomain: manifest.domain,
        connectionName,
        replyToActivityId: sentActivityId,
        conversationId: context.activity.conversation?.id,
        channelUserId,
        channelId,
      });
    }
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
      await signOutUserFromTurnContext(context, manifest.linkConfig.connectionName);
      await this.clearLocalSkillLinkState(userId);
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

    await this.clearLocalSkillLinkState(userId);

    // Unlink first (silently)
    try {
      await signOutUserFromTurnContext(context, manifest.linkConfig.connectionName);
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
    const sentActivityId = await this.sendFreshMessage(context, { attachments: [card] });
    const aadUserId = context.activity.from.aadObjectId;
    if (aadUserId && sentActivityId) {
      await registerPendingLinkChallenge({
        userId: aadUserId,
        skillDomain: manifest.domain,
        connectionName: manifest.linkConfig.connectionName,
        replyToActivityId: sentActivityId,
        conversationId: context.activity.conversation?.id,
        channelUserId: context.activity.from.id,
        channelId: context.activity.channelId ?? '',
      });
    }
  }

  private async clearLocalSkillLinkState(userId: string): Promise<void> {
    await Promise.all([
      clearPendingLinkChallenge(userId),
      clearOboSession(userId),
    ]);
  }

  private async getSkillSignInLink(
    context: TurnContext,
    connectionName: string,
  ): Promise<string | undefined> {
    try {
      return await getSignInLinkForTurnContext(context, connectionName);
    } catch {
      return undefined;
    }
  }

  private async tryCompletePendingSkillLink(
    context: TurnContext,
    pendingLinkChallenge: PendingLinkChallenge,
    authCode: string,
  ): Promise<boolean> {
    const channelUserId = context.activity.from.id;
    const channelId = context.activity.channelId ?? '';

    try {
      const directTurnToken = await redeemMagicCodeForTurnContext(
        context,
        pendingLinkChallenge.connectionName,
        authCode,
      );
      const redemption = await redeemMagicCodeWithFallbackForConnection(
        pendingLinkChallenge.connectionName,
        authCode,
        [
          ...(pendingLinkChallenge.channelUserId !== undefined
            ? [{
                userId: pendingLinkChallenge.channelUserId,
                channelId: pendingLinkChallenge.channelId ?? channelId,
              }]
            : []),
          { userId: channelUserId, channelId },
        ],
      );
      const token = directTurnToken ?? redemption?.token;

      if (token) {
        if (
          redemption !== undefined &&
          (redemption.userId !== channelUserId || redemption.channelId !== channelId)
        ) {
          console.info(
            `[HelkinSwarmBot] Magic code redeemed using stored tuple for userId=${pendingLinkChallenge.userId}: redeemedUserId=${redemption.userId} redeemedChannelId=${redemption.channelId} currentUserId=${channelUserId} currentChannelId=${channelId}`,
          );
        }

        // Manual `/link` / `/relink` magic-code redemption returns the Bot Framework
        // OAuth connection token for the linked resource. That is enough for the
        // current legacy linked-token path, but it is not the same thing as the
        // Teams SSO assertion used by the real OBO bootstrap flows
        // (`handleTeamsSigninTokenExchange` and `tab/bootstrap-obo`).
        // Treating this linked Graph token as an OBO assertion produces misleading
        // post-link failures even though the user is actually linked successfully.
        trackEvent({
          name: 'HandlerTokenSource',
          correlationId: `link-${crypto.randomUUID()}`,
          userId: pendingLinkChallenge.userId,
          properties: {
            handler: pendingLinkChallenge.skillDomain,
            source: 'magic-code-linked-token',
          },
        });

        await clearPendingLinkChallenge(pendingLinkChallenge.userId);
        await context.sendActivity(
          `✅ **${pendingLinkChallenge.skillDomain}** linked successfully. You can now use its delegated features.`,
        );
        return true;
      }
    } catch {
      // Fall through to the retry guidance below.
    }

    await context.sendActivity(
      `⚠️ That sign-in code was not accepted for **${pendingLinkChallenge.skillDomain}**. Please use \`/link ${pendingLinkChallenge.skillDomain}\` to get a fresh sign-in link, then paste the new code directly.`,
    );
    return true;
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
    const replyToId = activity.replyToId ?? extractMessageReferenceId(activity.attachments);

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

    // 4. Teams desktop/web quoted replies may arrive as messageReference attachments (#221)
    const messageReferencePreview = extractMessageReferencePreview(activity.attachments);
    if (replyToId && messageReferencePreview) {
      return { text: messageReferencePreview, replyToId, source: 'messageReference', mayBeTruncated: true };
    }

    // 5. Fallback: extract from HTML body if textFormat is 'html'
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

}
