// Overseer — the brain of HelkinSwarm.
// Processes exactly one message per instance, then completes.
// State survives via Cosmos DB (loadState/saveState).
// raiseToOverseer handles purge + startNew for each new message.
// #280: Removed ContinueAsNew — Azure Storage backend does NOT truncate history,
// causing unbounded growth (0→36→72+ events), progressively slower replays,
// ExternalEventDropped, and eventually stuck orchestrators.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { ConversationReference } from 'botbuilder';
import {
  type OverseerState,
  createInitialState,
} from './stateManager.js';
import type { SessionInput, SessionResult } from './sessionOrchestrator.js';
import type { SaveStateInput } from './saveStateActivity.js';
import type { LoadStateInput } from './loadStateActivity.js';
import type { SendReplyInput } from './sendReplyActivity.js';
import type { SpinnerHeartbeatInput } from './spinnerHeartbeatActivity.js';
import type { TerminateOrchestrationInput } from './terminateOrchestrationActivity.js';
import type { PurgeOrchestrationInput } from './terminateOrchestrationActivity.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import type { QuotedContext } from '../bot/quotedContext.js';
import type { RuntimeAssetReference } from '../integrations/runtimeAssetStore.js';
import { MIND_SESSION_GUARD_ENTITY_NAME, MindSessionGuardReleaseInputSchema } from './mindSessionGuard.js';
import type { SaveChronoContinuityInput } from './chronoBackplane.js';
import type { BufferedIngressActivityInput } from './bufferedIngressActivity.js';
import type { IngressWindowStageInput } from './ingressWindowStageActivity.js';
import { trackEvent } from '../observability/telemetry.js';

/** Spinner starts after this many ms. Only long turns get spinner updates. */
const SPINNER_INITIAL_DELAY_MS = 8_000;
/** Interval between spinner frame updates once started. */
const SPINNER_INTERVAL_MS = 8_000;
/** Hard cap on spinner ticks to prevent quadratic replay overhead in Durable Functions. */
const MAX_SPINNER_TICKS = 6;
/** Poll buffered ingress during the waiting window to absorb short Cosmos visibility lag. */
const INGRESS_BUFFER_POLL_MS = 2_000;
/**
 * How long to keep the overseer instance in Running state after processing.
 * Azure Storage startNew silently overwrites Completed instances, so this timer
 * ensures any Bot Connector retry hitting a different container gets a 409 instead
 * of spawning a duplicate orchestrator (#300).
 */
const DEDUP_HOLD_MS = 60_000;

export interface NewMessageEvent {
  userMessage: string;
  conversationReference?: Partial<ConversationReference>;
  userId: string;
  userAlias: string;
  skillForgeRequest?: {
    idea: string;
  };
  /** Full correlation ID for end-to-end stage tracing (#327). */
  correlationId?: string;
  /** Optional model override: 'primary', 'secondary', or a direct deployment name (e.g. 'o4-mini'). */
  modelOverride?: string;
  /** Image URLs extracted from Teams attachments (#130) */
  imageUrls?: string[];
  /** Structured runtime asset references extracted from inbound Teams attachments (#416) */
  runtimeAssets?: RuntimeAssetReference[];
  /** Prompt-safe notes about inbound attachment ingestion outcomes (#416) */
  attachmentNotices?: string[];
  /** Parsed DevLoop protocol context when message has protocol markers (#147) */
  devLoopContext?: DevLoopContext;
  /** Short correlation tag (first 8 chars of correlationId) for ack/spinner tracing (#267) */
  correlationTag?: string;
  /** Structured quoted-reply context from Teams reply-with-quote (#278) */
  quotedContext?: QuotedContext;
}

interface HookFiredEvent {
  hookId: string;
  userId: string;
  hookType: string;
  triggerType: string;
  originalIntent: string;
  correlationId?: string;
  payload: Record<string, unknown>;
  firedAt: string;
}

interface BufferedIngressQueuedEvent {
  docId?: string;
  correlationId?: string;
}

interface OverseerCustomStatus {
  stage: 'active-processing' | 'awaiting-ingress';
  correlationId: string;
}

df.app.orchestration('overseer', function* (context) {
  // Each instance handles exactly one message, then completes.
  // raiseToOverseer provides the NewMessageEvent as input.
  const msg = context.df.getInput() as NewMessageEvent;

  // Restore state from Cosmos (survives orchestrator purge / container restart)
  const restoredState: OverseerState | null = yield context.df.callActivity(
    'loadStateActivity',
    { userId: msg.userId, correlationId: msg.correlationId } satisfies LoadStateInput,
  );

  const state: OverseerState = restoredState ?? createInitialState({
    userId: msg.userId,
    userAlias: msg.userAlias,
    conversationId: msg.conversationReference?.conversation?.id ?? 'unknown',
  });

  let nextMessage: NewMessageEvent = msg;

  while (true) {
    const completedCorrelationId = yield* processTurn(context, state, nextMessage);
    if (!completedCorrelationId) {
      return;
    }

    const bufferedNewMessage = (yield context.df.callActivity('bufferedIngressActivity', {
      action: 'dequeue-new-message',
      userId: state.userId,
      targetInstanceId: context.df.instanceId,
    } satisfies BufferedIngressActivityInput)) as NewMessageEvent | null;

    if (bufferedNewMessage) {
      const drainedCorrelationId = bufferedNewMessage.correlationId ?? crypto.randomUUID();

      yield context.df.callActivity('ingressWindowStageActivity', {
        action: 'drain',
        correlationId: completedCorrelationId,
        nextCorrelationId: drainedCorrelationId,
        userId: state.userId,
        instanceId: context.df.instanceId,
      } satisfies IngressWindowStageInput);

      nextMessage = {
        ...bufferedNewMessage,
        correlationId: drainedCorrelationId,
      };
      continue;
    }

    context.df.setCustomStatus({
      stage: 'awaiting-ingress',
      correlationId: completedCorrelationId,
    } satisfies OverseerCustomStatus);

    yield context.df.callActivity('ingressWindowStageActivity', {
      action: 'open',
      correlationId: completedCorrelationId,
      userId: state.userId,
      instanceId: context.df.instanceId,
    } satisfies IngressWindowStageInput);

    const ingressDeadline = new Date(context.df.currentUtcDateTime.getTime() + DEDUP_HOLD_MS);
    const ingressTimer = context.df.createTimer(ingressDeadline);
    const newMessageEvent = context.df.waitForExternalEvent('NewMessage');
    const hookFiredEvent = context.df.waitForExternalEvent('HookFired');
    let bufferedIngressQueuedEvent = context.df.waitForExternalEvent('BufferedIngressQueued');
    let bufferedPollDeadline = new Date(
      Math.min(context.df.currentUtcDateTime.getTime() + INGRESS_BUFFER_POLL_MS, ingressDeadline.getTime()),
    );
    let bufferedPollTimer = context.df.createTimer(bufferedPollDeadline);

    while (true) {
      const winner = yield context.df.Task.any([
        newMessageEvent,
        hookFiredEvent,
        bufferedIngressQueuedEvent,
        ingressTimer,
        bufferedPollTimer,
      ]) as df.Task;

      if (winner === newMessageEvent) {
        ingressTimer.cancel();
        bufferedPollTimer.cancel();
        const drainedMessage = newMessageEvent.result as NewMessageEvent;
        const drainedCorrelationId = drainedMessage.correlationId ?? crypto.randomUUID();

        yield context.df.callActivity('ingressWindowStageActivity', {
          action: 'drain',
          correlationId: completedCorrelationId,
          nextCorrelationId: drainedCorrelationId,
          userId: state.userId,
          instanceId: context.df.instanceId,
        } satisfies IngressWindowStageInput);

        nextMessage = {
          ...drainedMessage,
          correlationId: drainedCorrelationId,
        };
        break;
      }

      if (winner === hookFiredEvent) {
        ingressTimer.cancel();
        bufferedPollTimer.cancel();
        const drainedHook = hookFiredEvent.result as HookFiredEvent;
        const drainedCorrelationId = drainedHook.correlationId ?? crypto.randomUUID();

        yield context.df.callActivity('ingressWindowStageActivity', {
          action: 'hook-drain',
          correlationId: completedCorrelationId,
          nextCorrelationId: drainedCorrelationId,
          userId: state.userId,
          instanceId: context.df.instanceId,
          hookId: drainedHook.hookId,
          hookType: drainedHook.hookType,
          triggerType: drainedHook.triggerType,
        } satisfies IngressWindowStageInput);

        nextMessage = {
          userMessage: drainedHook.originalIntent,
          userId: state.userId,
          userAlias: state.userAlias,
          correlationId: drainedCorrelationId,
        };
        break;
      }

      if (winner === ingressTimer) {
        bufferedPollTimer.cancel();
        yield context.df.callActivity('ingressWindowStageActivity', {
          action: 'clear',
          correlationId: completedCorrelationId,
          userId: state.userId,
        } satisfies IngressWindowStageInput);

        return;
      }

      if (winner === bufferedIngressQueuedEvent) {
        const bufferedIngressSignal = bufferedIngressQueuedEvent.result as BufferedIngressQueuedEvent;
        bufferedIngressQueuedEvent = context.df.waitForExternalEvent('BufferedIngressQueued');

        if (bufferedIngressSignal.docId) {
          const claimedBufferedMessage = (yield context.df.callActivity('bufferedIngressActivity', {
            action: 'claim-buffered-message',
            userId: state.userId,
            docId: bufferedIngressSignal.docId,
            targetInstanceId: context.df.instanceId,
          } satisfies BufferedIngressActivityInput)) as NewMessageEvent | null;

          if (claimedBufferedMessage) {
            ingressTimer.cancel();
            bufferedPollTimer.cancel();
            const drainedCorrelationId = claimedBufferedMessage.correlationId
              ?? bufferedIngressSignal.correlationId
              ?? crypto.randomUUID();

            yield context.df.callActivity('ingressWindowStageActivity', {
              action: 'drain',
              correlationId: completedCorrelationId,
              nextCorrelationId: drainedCorrelationId,
              userId: state.userId,
              instanceId: context.df.instanceId,
            } satisfies IngressWindowStageInput);

            nextMessage = {
              ...claimedBufferedMessage,
              correlationId: drainedCorrelationId,
            };
            break;
          }
        }
      }

      const bufferedDuringIngressWindow = (yield context.df.callActivity('bufferedIngressActivity', {
        action: 'dequeue-new-message',
        userId: state.userId,
        targetInstanceId: context.df.instanceId,
      } satisfies BufferedIngressActivityInput)) as NewMessageEvent | null;

      if (bufferedDuringIngressWindow) {
        ingressTimer.cancel();
        const drainedCorrelationId = bufferedDuringIngressWindow.correlationId ?? crypto.randomUUID();

        yield context.df.callActivity('ingressWindowStageActivity', {
          action: 'drain',
          correlationId: completedCorrelationId,
          nextCorrelationId: drainedCorrelationId,
          userId: state.userId,
          instanceId: context.df.instanceId,
        } satisfies IngressWindowStageInput);

        nextMessage = {
          ...bufferedDuringIngressWindow,
          correlationId: drainedCorrelationId,
        };
        break;
      }

      if (context.df.currentUtcDateTime.getTime() >= ingressDeadline.getTime()) {
        ingressTimer.cancel();
        yield context.df.callActivity('ingressWindowStageActivity', {
          action: 'clear',
          correlationId: completedCorrelationId,
          userId: state.userId,
        } satisfies IngressWindowStageInput);

        return;
      }

      bufferedPollDeadline = new Date(
        Math.min(context.df.currentUtcDateTime.getTime() + INGRESS_BUFFER_POLL_MS, ingressDeadline.getTime()),
      );
      bufferedPollTimer = context.df.createTimer(bufferedPollDeadline);
    }
    continue;
  }
});

// Helper generator to process a turn
function* processTurn(
  context: df.OrchestrationContext,
  state: OverseerState,
  event: NewMessageEvent,
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Durable Functions runtime drives the generator with mixed types
): Generator<df.Task, string | undefined, any> {
  const correlationId = event.correlationId ?? crypto.randomUUID();
  trackEvent({
    name: 'TurnStarted',
    correlationId,
    userId: state.userId,
    properties: {
      instanceId: context.df.instanceId,
      source: event.devLoopContext?.isDevLoop ? 'devloop-relay' : 'teams-message',
    },
  });

  const sessionInput: SessionInput = {
    state,
    userMessage: event.userMessage,
    ...(event.skillForgeRequest ? { skillForgeRequest: event.skillForgeRequest } : {}),
    conversationReference: event.conversationReference,
    correlationId,
    modelOverride: event.modelOverride,
    imageUrls: event.imageUrls,
    runtimeAssets: event.runtimeAssets,
    attachmentNotices: event.attachmentNotices,
    devLoopContext: event.devLoopContext,
    quotedContext: event.quotedContext,
  };

  yield context.df.callActivity('ingressWindowStageActivity', {
    action: 'mark-active-processing',
    correlationId,
    userId: state.userId,
    instanceId: context.df.instanceId,
  } satisfies IngressWindowStageInput);
  context.df.setCustomStatus({
    stage: 'active-processing',
    correlationId,
  } satisfies OverseerCustomStatus);

  // Guard: race sub-orchestrator against a 5-minute timeout (#211)
  const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
  const sessionDeadline = new Date(context.df.currentUtcDateTime.getTime() + SESSION_TIMEOUT_MS);
  const sessionTimer = context.df.createTimer(sessionDeadline);

  // Assign a deterministic per-turn instanceId so each drained NewMessage turn gets
  // a fresh sub-orchestrator identity inside the same living overseer session.
  // Reusing one static session instanceId across multiple drained turns risks Durable
  // attaching later work to stale prior sub-orchestrator state instead of a fresh turn.
  const sessionInstanceId = `session-${context.df.instanceId}-${sessionInput.correlationId}`;

  // Pre-purge stale sub-orchestrator instances (#327).
  // If a previous overseer run left a session instance in Running/Terminated state,
  // callSubOrchestrator would silently wait for it instead of creating a new one.
  yield context.df.callActivity('purgeOrchestrationActivity', {
    instanceId: sessionInstanceId,
  } satisfies PurgeOrchestrationInput);

  const sessionTask = context.df.callSubOrchestrator(
    'sessionOrchestrator',
    sessionInput,
    sessionInstanceId,
  );

  // Spinner heartbeat (#267)
  const correlationTag = event.correlationTag ?? sessionInput.correlationId.slice(0, 8);
  let spinnerDeadline = new Date(context.df.currentUtcDateTime.getTime() + SPINNER_INITIAL_DELAY_MS);
  let spinnerTimer: df.TimerTask = context.df.createTimer(spinnerDeadline);

  let sessionResult: SessionResult;
  try {
    let sessionDone = false;
    let timedOut = false;
    let spinnerTicks = 0;

    while (!sessionDone && !timedOut) {
      const raceTasks = spinnerTicks < MAX_SPINNER_TICKS
        ? [sessionTask, sessionTimer, spinnerTimer]
        : [sessionTask, sessionTimer];
      const winner = yield context.df.Task.any(raceTasks) as df.Task;

      if (winner === sessionTimer) {
        timedOut = true;
        spinnerTimer.cancel();
        console.error(`[overseer] processTurn timed out after ${SESSION_TIMEOUT_MS}ms for user=${state.userId}`);

        // Kill the orphaned sub-orchestrator to prevent zombie sessions (#325).
        try {
          yield context.df.callActivity('terminateOrchestrationActivity', {
            instanceId: sessionInstanceId,
            reason: `Overseer timeout after ${SESSION_TIMEOUT_MS}ms for user=${state.userId}`,
          } satisfies TerminateOrchestrationInput);
        } catch (termErr) {
          console.warn(`[overseer] Failed to terminate session ${sessionInstanceId}:`, termErr);
        }

        try {
          const errorReply: SendReplyInput = {
            userId: state.userId,
            message: `⏰ Your message took too long to process (>${SESSION_TIMEOUT_MS / 60000} min). The turn was cancelled. Please try again.`,
            correlationId: sessionInput.correlationId,
          };
          yield context.df.callActivity('sendReplyActivity', errorReply);
        } catch (replyErr) {
          console.error(`[overseer] Failed to send timeout reply for user=${state.userId}`, replyErr);
        }
        yield context.df.callActivity('saveStateActivity', {
          state,
          correlationId: sessionInput.correlationId,
        } satisfies SaveStateInput);
        yield context.df.callActivity('ingressWindowStageActivity', {
          action: 'clear',
          correlationId: sessionInput.correlationId,
          userId: state.userId,
        } satisfies IngressWindowStageInput);
        return undefined;
      } else if (winner === spinnerTimer) {
        spinnerTicks++;
        yield context.df.callActivity('spinnerHeartbeatActivity', {
          userId: state.userId,
          correlationId: sessionInput.correlationId,
          correlationTag,
        } satisfies SpinnerHeartbeatInput);
        if (spinnerTicks < MAX_SPINNER_TICKS) {
          spinnerDeadline = new Date(context.df.currentUtcDateTime.getTime() + SPINNER_INTERVAL_MS);
          spinnerTimer = context.df.createTimer(spinnerDeadline);
        }
      } else {
        sessionDone = true;
        sessionTimer.cancel();
        spinnerTimer.cancel();
      }
    }

    sessionResult = sessionTask.result as SessionResult;
  } catch (err) {
    sessionTimer.cancel();
    spinnerTimer.cancel();
    console.error(`[overseer] processTurn failed for user=${state.userId}`, err);
    try {
      const errorReply: SendReplyInput = {
        userId: state.userId,
        message: `⚠️ Something went wrong processing your message. The error has been logged. Please try again.`,
        correlationId: sessionInput.correlationId,
      };
      yield context.df.callActivity('sendReplyActivity', errorReply);
    } catch (replyErr) {
      console.error(`[overseer] Failed to send error reply for user=${state.userId}`, replyErr);
    }
    yield context.df.callActivity('saveStateActivity', {
      state,
      correlationId: sessionInput.correlationId,
    } satisfies SaveStateInput);
    yield context.df.callActivity('ingressWindowStageActivity', {
      action: 'clear',
      correlationId: sessionInput.correlationId,
      userId: state.userId,
    } satisfies IngressWindowStageInput);
    context.df.signalEntity(
      new df.EntityId(MIND_SESSION_GUARD_ENTITY_NAME, state.userId),
      'release',
      MindSessionGuardReleaseInputSchema.parse({
        instanceId: context.df.instanceId,
        correlationId: sessionInput.correlationId,
      }),
    );
    // Dedup hold on error path — keep Running to block retries (#300)
    const errDedupDeadline = new Date(context.df.currentUtcDateTime.getTime() + DEDUP_HOLD_MS);
    yield context.df.createTimer(errDedupDeadline);
    return undefined;
  }

  state.latestPromptTokens = sessionResult.promptTokens;
  state.accumulatedTokens = (state.accumulatedTokens ?? 0) + sessionResult.tokensUsed;
  state.model = sessionResult.model;
  if (sessionResult.pendingClarification !== undefined) {
    state.pendingClarification = sessionResult.pendingClarification ?? undefined;
  }
  state.turnCount++;
  state.lastActivityTimestamp = context.df.currentUtcDateTime.toISOString();

  // Append conversation turn to recentHistory (#203)
  const history = state.recentHistory ?? [];
  history.push(
    { role: 'user' as const, content: event.userMessage },
    { role: 'assistant' as const, content: sessionResult.cleanResponse || sessionResult.response || '(no response)' },
  );
  state.recentHistory = history.slice(-10);

  try {
    yield context.df.callActivity('saveStateActivity', {
      state,
      correlationId: sessionInput.correlationId,
    } satisfies SaveStateInput);
  } catch (saveStateError) {
    console.warn(
      `[overseer] saveStateActivity failed after reply for user=${state.userId} correlationId=${sessionInput.correlationId}`,
      saveStateError,
    );
  }

  try {
    yield context.df.callActivity('saveChronoContinuityActivity', {
      userId: state.userId,
      correlationId: sessionInput.correlationId,
      userMessage: event.userMessage,
      assistantReply: sessionResult.cleanResponse || sessionResult.response || '(no response)',
    } satisfies SaveChronoContinuityInput);
  } catch (saveChronoError) {
    console.warn(
      `[overseer] saveChronoContinuityActivity failed after reply for user=${state.userId} correlationId=${sessionInput.correlationId}`,
      saveChronoError,
    );
  }

  context.df.signalEntity(
    new df.EntityId(MIND_SESSION_GUARD_ENTITY_NAME, state.userId),
    'release',
    MindSessionGuardReleaseInputSchema.parse({
      instanceId: context.df.instanceId,
      correlationId: sessionInput.correlationId,
    }),
  );

  trackEvent({
    name: 'TurnCompleted',
    correlationId,
    userId: state.userId,
    properties: {
      instanceId: context.df.instanceId,
      replySent: sessionResult.replySent,
      safetyPassed: sessionResult.safetyPassed,
      model: sessionResult.model,
    },
  });

  return correlationId;
}
