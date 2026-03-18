// Session sub-orchestrator — handles one complete turn.
// Loads prompt, calls LLM, dispatches tools, returns result.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { OverseerState } from './stateManager.js';
import type { BuildPromptInput, PromptResult } from './buildPromptActivity.js';
import type { LlmResult } from './llmActivity.js';
import type { SendReplyInput, SendReplyResult } from './sendReplyActivity.js';
import type { ConversationReference } from 'botbuilder';

export interface SessionInput {
  state: OverseerState;
  userMessage: string;
  conversationReference: Partial<ConversationReference>;
}

export interface SessionResult {
  response: string;
  tokensUsed: number;
  model: string;
  toolCalls: Array<{ name: string; arguments: string }>;
  replySent: boolean;
}

df.app.orchestration('sessionOrchestrator', function* (context) {
  const input: SessionInput = context.df.getInput() as SessionInput;

  // 1. Build prompt (persona + summary + user message)
  const promptInput: BuildPromptInput = {
    state: input.state,
    userMessage: input.userMessage,
  };
  const prompt: PromptResult = yield context.df.callActivity(
    'buildPromptActivity',
    promptInput,
  );

  // 2. Call LLM
  const llmResult: LlmResult = yield context.df.callActivity(
    'llmActivity',
    prompt,
  );

  // 3. Send reply to Teams (proactive)
  const replyInput: SendReplyInput = {
    conversationReference: input.conversationReference,
    message: llmResult.content,
  };
  const replyResult: SendReplyResult = yield context.df.callActivity(
    'sendReplyActivity',
    replyInput,
  );

  const result: SessionResult = {
    response: llmResult.content,
    tokensUsed: llmResult.tokensUsed,
    model: llmResult.model,
    toolCalls: llmResult.toolCalls,
    replySent: replyResult.success,
  };

  return result;
});
