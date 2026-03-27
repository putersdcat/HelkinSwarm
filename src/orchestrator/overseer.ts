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
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import type { QuotedContext } from '../bot/quotedContext.js';

/** Spinner starts after this many ms. Only long turns get spinner updates. */
const SPINNER_INITIAL_DELAY_MS = 8_000;
/** Interval between spinner frame updates once started. */
const SPINNER_INTERVAL_MS = 8_000;
/** Hard cap on spinner ticks to prevent quadratic replay overhead in Durable Functions. */
const MAX_SPINNER_TICKS = 6;
/**
 * How long to keep the overseer instance in Running state after processing.
 * Azure Storage startNew silently overwrites Completed instances, so this timer
 * ensures any Bot Connector retry hitting a different container gets a 409 instead
 * of spawning a duplicate orchestrator (#300).
 */
const DEDUP_HOLD_MS = 60_000;

export interface NewMessageEvent {
  userMessage: string;
  conversationReference: Partial<ConversationReference>;
  userId: string;
  userAlias: string;
  /** Full correlation ID for end-to-end stage tracing (#327). */
  correlationId?: string;
  /** Optional model override: 'primary', 'secondary', or a direct deployment name (e.g. 'o4-mini'). */
  modelOverride?: string;
  /** Image URLs extracted from Teams attachments (#130) */
  imageUrls?: string[];
  /** Parsed DevLoop protocol context when message has protocol markers (#147) */
  devLoopContext?: DevLoopContext;
  /** Short correlation tag (first 8 chars of correlationId) for ack/spinner tracing (#267) */
  correlationTag?: string;
  /** Structured quoted-reply context from Teams reply-with-quote (#278) */
  quotedContext?: QuotedContext;
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
    conversationId: msg.conversationReference.conversation?.id ?? 'unknown',
  });

  // Process this message — overseer completes naturally after processTurn returns
  yield* processTurn(context, state, msg);
});

// Helper generator to process a turn
function* processTurn(
  context: df.OrchestrationContext,
  state: OverseerState,
  event: NewMessageEvent,
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Durable Functions runtime drives the generator with mixed types
): Generator<df.Task, void, any> {
  const sessionInput: SessionInput = {
    state,
    userMessage: event.userMessage,
    conversationReference: event.conversationReference,
    correlationId: event.correlationId ?? crypto.randomUUID(),
    modelOverride: event.modelOverride,
    imageUrls: event.imageUrls,
    devLoopContext: event.devLoopContext,
  };

  // Guard: race sub-orchestrator against a 5-minute timeout (#211)
  const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
  const sessionDeadline = new Date(context.df.currentUtcDateTime.getTime() + SESSION_TIMEOUT_MS);
  const sessionTimer = context.df.createTimer(sessionDeadline);

  // Assign a deterministic instanceId so we can terminate on timeout (#325).
  const sessionInstanceId = `session-${context.df.instanceId}`;
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
          };
          yield context.df.callActivity('sendReplyActivity', errorReply);
        } catch (replyErr) {
          console.error(`[overseer] Failed to send timeout reply for user=${state.userId}`, replyErr);
        }
        yield context.df.callActivity('saveStateActivity', { state } satisfies SaveStateInput);
        return;
      } else if (winner === spinnerTimer) {
        spinnerTicks++;
        yield context.df.callActivity('spinnerHeartbeatActivity', {
          userId: state.userId,
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
      };
      yield context.df.callActivity('sendReplyActivity', errorReply);
    } catch (replyErr) {
      console.error(`[overseer] Failed to send error reply for user=${state.userId}`, replyErr);
    }
    yield context.df.callActivity('saveStateActivity', { state } satisfies SaveStateInput);
    // Dedup hold on error path — keep Running to block retries (#300)
    const errDedupDeadline = new Date(context.df.currentUtcDateTime.getTime() + DEDUP_HOLD_MS);
    yield context.df.createTimer(errDedupDeadline);
    return;
  }

  state.latestPromptTokens = sessionResult.promptTokens;
  state.accumulatedTokens = (state.accumulatedTokens ?? 0) + sessionResult.tokensUsed;
  state.model = sessionResult.model;
  state.turnCount++;
  state.lastActivityTimestamp = context.df.currentUtcDateTime.toISOString();

  // Append conversation turn to recentHistory (#203)
  const history = state.recentHistory ?? [];
  history.push(
    { role: 'user' as const, content: event.userMessage },
    { role: 'assistant' as const, content: sessionResult.cleanResponse || sessionResult.response || '(no response)' },
  );
  state.recentHistory = history.slice(-10);

  yield context.df.callActivity('saveStateActivity', { state } satisfies SaveStateInput);

  // Dedup hold:  keep this instance alive (Running) for 60s after processing so
  // that retried Bot Connector POSTs see a Running instance and get 409 from
  // startNew, preventing duplicate responses.  Azure Storage backend silently
  // overwrites Completed instances on startNew, so this timer is the critical
  // dedup layer for cross-container retries (#300).
  const dedupDeadline = new Date(context.df.currentUtcDateTime.getTime() + DEDUP_HOLD_MS);
  yield context.df.createTimer(dedupDeadline);
  // Overseer completes naturally after the dedup hold — no ContinueAsNew (#280)
}
