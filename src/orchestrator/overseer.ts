// Eternal Overseer — the brain of HelkinSwarm.
// Never ends: processes one message, then ContinueAsNew with carried-over summary.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { ConversationReference } from 'botbuilder';
import {
  type OverseerState,
  createInitialState,
  stateForContinueAsNew,
} from './stateManager.js';
import {
  createTokenBudget,
  recordTokenUsage,
  shouldContinueAsNew,
  shouldSummarize,
} from './tokenBudget.js';
import type { SessionInput, SessionResult } from './sessionOrchestrator.js';
import type { SummarizeInput, SummarizeResult } from './summarizeActivity.js';
import type { SaveStateInput } from './saveStateActivity.js';
import type { LoadStateInput } from './loadStateActivity.js';
import type { SendReplyInput } from './sendReplyActivity.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';

export interface NewMessageEvent {
  userMessage: string;
  conversationReference: Partial<ConversationReference>;
  userId: string;
  userAlias: string;
  /** Optional model override: 'primary', 'secondary', or a direct deployment name (e.g. 'o4-mini'). */
  modelOverride?: string;
  /** Image URLs extracted from Teams attachments (#130) */
  imageUrls?: string[];
  /** Parsed DevLoop protocol context when message has protocol markers (#147) */
  devLoopContext?: DevLoopContext;
}

df.app.orchestration('overseer', function* (context) {
  // Load or initialize state from input
  const rawInput = context.df.getInput();
  let state: OverseerState;

  if (rawInput && typeof rawInput === 'object' && 'userId' in (rawInput as Record<string, unknown>)) {
    state = rawInput as OverseerState;
  } else {
    // First launch — wait for first message to get user info
    const firstMsg: NewMessageEvent = yield context.df.waitForExternalEvent(
      'NewMessage',
    );

    // Attempt to restore state from Cosmos (survives orchestrator purge / container restart)
    const restoredState: OverseerState | null = yield context.df.callActivity(
      'loadStateActivity',
      { userId: firstMsg.userId } satisfies LoadStateInput,
    );

    if (restoredState) {
      state = restoredState;
    } else {
      state = createInitialState({
        userId: firstMsg.userId,
        userAlias: firstMsg.userAlias,
        conversationId: firstMsg.conversationReference.conversation?.id ?? 'unknown',
      });
    }

    // Process this first message immediately
    yield* processTurn(context, state, firstMsg);
    return;
  }

  // Initialize token budget from state — uses latest prompt tokens for pressure measurement (#137)
  let tokenBudget = createTokenBudget(state.model ?? 'grok-4-1-fast-non-reasoning');
  if (state.latestPromptTokens) {
    tokenBudget = recordTokenUsage(tokenBudget, state.latestPromptTokens, 0);
  }

  // Main eternal loop: wait for events, process, decide whether to ContinueAsNew
  // Each iteration handles one message, then the orchestrator checks budget.
  const event: NewMessageEvent = yield context.df.waitForExternalEvent(
    'NewMessage',
  );

  // Delegate turn to session sub-orchestrator
  const sessionInput: SessionInput = {
    state,
    userMessage: event.userMessage,
    conversationReference: event.conversationReference,
    correlationId: crypto.randomUUID(),
    modelOverride: event.modelOverride,
    imageUrls: event.imageUrls,
    devLoopContext: event.devLoopContext,
  };

  // Guard: race sub-orchestrator against a 5-minute timeout (#211)
  // Without this, a hung LLM call blocks the overseer forever.
  const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
  const sessionDeadline = new Date(context.df.currentUtcDateTime.getTime() + SESSION_TIMEOUT_MS);
  const sessionTimer = context.df.createTimer(sessionDeadline);
  const sessionTask = context.df.callSubOrchestrator(
    'sessionOrchestrator',
    sessionInput,
  );

  let sessionResult: SessionResult;
  try {
    const winner: df.Task = yield context.df.Task.any([sessionTask, sessionTimer]);
    if (winner === sessionTimer) {
      // Session timed out — notify user and cycle the overseer
      console.error(`[overseer] sessionOrchestrator timed out after ${SESSION_TIMEOUT_MS}ms for user=${state.userId}`);
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
      context.df.continueAsNew(state);
      return;
    }
    sessionTimer.cancel();
    sessionResult = sessionTask.result as SessionResult;
  } catch (err) {
    sessionTimer.cancel();
    // Session failed — send error reply to user and continue (don't crash the overseer)
    console.error(`[overseer] sessionOrchestrator failed for user=${state.userId}`, err);
    try {
      const errorReply: SendReplyInput = {
        userId: state.userId,
        message: `⚠️ Something went wrong processing your message. The error has been logged. Please try again.`,
      };
      yield context.df.callActivity('sendReplyActivity', errorReply);
    } catch (replyErr) {
      console.error(`[overseer] Failed to send error reply for user=${state.userId}`, replyErr);
    }
    // Persist state and cycle — overseer survives the failure
    yield context.df.callActivity('saveStateActivity', { state } satisfies SaveStateInput);
    context.df.continueAsNew(state);
    return;
  }

  // Update token budget — record prompt tokens for pressure measurement (#137)
  tokenBudget = recordTokenUsage(tokenBudget, sessionResult.promptTokens, sessionResult.tokensUsed);
  state.latestPromptTokens = tokenBudget.latestPromptTokens;
  state.accumulatedTokens = tokenBudget.accumulatedTokens;
  state.model = sessionResult.model;
  state.turnCount++;
  state.lastActivityTimestamp = new Date().toISOString();

  // Append conversation turn to recentHistory for multi-turn coherence (#203)
  // Use cleanResponse (pre-decoration) to avoid model-disclosure prefixes bleeding across turns
  const history = state.recentHistory ?? [];
  history.push(
    { role: 'user' as const, content: event.userMessage },
    { role: 'assistant' as const, content: sessionResult.cleanResponse ?? sessionResult.response },
  );
  // Keep last 10 entries (5 user+assistant pairs)
  state.recentHistory = history.slice(-10);

  // Check if we need to ContinueAsNew (80% context pressure) or summarize (75%)
  if (shouldContinueAsNew(tokenBudget) || shouldSummarize(tokenBudget)) {
    const summarizeInput: SummarizeInput = {
      currentSummary: state.summary,
      recentMessages: sessionResult.response,
      turnCount: state.turnCount,
    };
    const summarizeResult: SummarizeResult = yield context.df.callActivity(
      'summarizeActivity',
      summarizeInput,
    );

    // Note: Durable Functions JS SDK v3 does not support timeout on waitForExternalEvent.
    // Pending events will be picked up in the next ContinueAsNew cycle.

    // Build carry-over state for ContinueAsNew
    const newState = stateForContinueAsNew(state, summarizeResult.summary);
    yield context.df.callActivity('saveStateActivity', { state: newState } satisfies SaveStateInput);
    context.df.continueAsNew(newState);
    return;
  }

  // No summarization needed — persist state to Cosmos, then ContinueAsNew
  yield context.df.callActivity('saveStateActivity', { state } satisfies SaveStateInput);
  context.df.continueAsNew(state);
});

// Helper generator to process a turn (used for first message path)
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
    correlationId: crypto.randomUUID(),
    modelOverride: event.modelOverride,
    imageUrls: event.imageUrls,
    devLoopContext: event.devLoopContext,
  };

  // Guard: race sub-orchestrator against a 5-minute timeout (#211)
  const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
  const sessionDeadline = new Date(context.df.currentUtcDateTime.getTime() + SESSION_TIMEOUT_MS);
  const sessionTimer = context.df.createTimer(sessionDeadline);
  const sessionTask = context.df.callSubOrchestrator(
    'sessionOrchestrator',
    sessionInput,
  );

  let sessionResult: SessionResult;
  try {
    const winner = yield context.df.Task.any([sessionTask, sessionTimer]) as df.Task;
    if (winner === sessionTimer) {
      console.error(`[overseer] processTurn timed out after ${SESSION_TIMEOUT_MS}ms for user=${state.userId}`);
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
      context.df.continueAsNew(state);
      return;
    }
    sessionTimer.cancel();
    sessionResult = sessionTask.result as SessionResult;
  } catch (err) {
    // Session failed — send error reply and cycle
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
    context.df.continueAsNew(state);
    return;
  }

  state.latestPromptTokens = sessionResult.promptTokens;
  state.accumulatedTokens = (state.accumulatedTokens ?? 0) + sessionResult.tokensUsed;
  state.model = sessionResult.model;
  state.turnCount++;
  state.lastActivityTimestamp = new Date().toISOString();

  // Append conversation turn to recentHistory (#203)
  // Use cleanResponse (pre-decoration) to avoid model-disclosure prefixes bleeding across turns
  const history = state.recentHistory ?? [];
  history.push(
    { role: 'user' as const, content: event.userMessage },
    { role: 'assistant' as const, content: sessionResult.cleanResponse ?? sessionResult.response },
  );
  state.recentHistory = history.slice(-10);

  yield context.df.callActivity('saveStateActivity', { state } satisfies SaveStateInput);
  context.df.continueAsNew(state);
}
