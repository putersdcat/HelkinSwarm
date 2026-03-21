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

export interface NewMessageEvent {
  userMessage: string;
  conversationReference: Partial<ConversationReference>;
  userId: string;
  userAlias: string;
  /** Optional model override for /heavy and /light slash commands. */
  modelOverride?: 'primary' | 'secondary';
  /** Image URLs extracted from Teams attachments (#130) */
  imageUrls?: string[];
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
  };

  let sessionResult: SessionResult;
  try {
    sessionResult = yield context.df.callSubOrchestrator(
      'sessionOrchestrator',
      sessionInput,
    );
  } catch (err) {
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
): Generator<df.Task, void, SessionResult> {
  const sessionInput: SessionInput = {
    state,
    userMessage: event.userMessage,
    conversationReference: event.conversationReference,
    correlationId: crypto.randomUUID(),
    modelOverride: event.modelOverride,
    imageUrls: event.imageUrls,
  };

  let sessionResult: SessionResult;
  try {
    sessionResult = yield context.df.callSubOrchestrator(
      'sessionOrchestrator',
      sessionInput,
    );
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

  yield context.df.callActivity('saveStateActivity', { state } satisfies SaveStateInput);
  context.df.continueAsNew(state);
}
