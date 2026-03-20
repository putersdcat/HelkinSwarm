// Session sub-orchestrator — handles one complete turn.
// Loads prompt, calls LLM, dispatches tools through the safety pipeline, returns result.
// Spec ref: 08-Orchestrator-Patterns.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import type { OverseerState } from './stateManager.js';
import type { BuildPromptInput, PromptResult } from './buildPromptActivity.js';
import type { LlmResult } from './llmActivity.js';
import type { SendReplyInput, SendReplyResult } from './sendReplyActivity.js';
import type { ConversationReference } from 'botbuilder';

import type { ToolDispatchInput, ToolDispatchResult } from './toolDispatchActivity.js';
import type { LlmFollowUpInput } from './llmFollowUpActivity.js';

export interface SessionInput {
  state: OverseerState;
  userMessage: string;
  conversationReference: Partial<ConversationReference>;
  correlationId: string;
  /** Optional model override for /heavy and /light slash commands. */
  modelOverride?: 'primary' | 'secondary';
}

export interface SessionResult {
  response: string;
  tokensUsed: number;
  model: string;
  toolCalls: Array<{ name: string; arguments: string }>;
  toolResults: ToolDispatchResult | null;
  replySent: boolean;
  safetyPassed: boolean;
}

df.app.orchestration('sessionOrchestrator', function* (context) {
  const input: SessionInput = context.df.getInput() as SessionInput;
  const correlationId = input.correlationId ?? crypto.randomUUID();

  // 1. Build prompt (persona + summary + user message)
  const promptInput: BuildPromptInput = {
    state: input.state,
    userMessage: input.userMessage,
  };
  const prompt: PromptResult = yield context.df.callActivity(
    'buildPromptActivity',
    promptInput,
  );

  // 2. Call LLM (global frontier model via Foundry client)
  const llmResult: LlmResult = yield context.df.callActivity(
    'llmActivity',
    { ...prompt, correlationId, modelOverride: input.modelOverride },
  );

  // 3. If LLM returned tool calls, run the safety pipeline
  let toolResults: ToolDispatchResult | null = null;
  let safetyPassed = true;
  let responseContent = llmResult.content;

  if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
    // Run pre-execution verification
    const verification = yield context.df.callActivity('verificationPipelineActivity', {
      correlationId,
      sessionId: input.state.userId,
      userId: input.state.userId,
      toolName: 'multiple',
      risk: 'medium',
      rawOutput: llmResult.toolCalls,
      originalQuery: input.userMessage,
    });

    if (!verification.passed) {
      responseContent = `Safety pipeline blocked this action: ${verification.error}`;
      safetyPassed = false;
    } else {
      // Dispatch tools
      const dispatchInput: ToolDispatchInput = {
        toolCalls: llmResult.toolCalls,
        correlationId,
        sessionId: input.state.userId,
        userId: input.state.userId,
      };
      toolResults = yield context.df.callActivity('toolDispatchActivity', dispatchInput);

      // 3b. Call LLM again with tool results for natural language response
      const followUpInput: LlmFollowUpInput = {
        originalMessages: prompt.messages,
        assistantToolCallMessage: {
          content: llmResult.content,
          toolCalls: llmResult.toolCalls,
        },
        toolResults: toolResults?.results ?? [],
        correlationId,
        modelOverride: input.modelOverride,
      };
      const followUp: LlmResult = yield context.df.callActivity('llmFollowUpActivity', followUpInput);
      responseContent = followUp.content;
    }
  }

  // 4. Guard against empty response — Teams rejects empty text
  if (!responseContent || responseContent.trim().length === 0) {
    responseContent = 'I processed your request but have nothing to report back.';
  }

  // 5. Send reply to Teams (proactive)
  const replyInput: SendReplyInput = {
    userId: input.state.userId,
    message: responseContent,
  };
  const replyResult: SendReplyResult = yield context.df.callActivity(
    'sendReplyActivity',
    replyInput,
  );

  return {
    response: responseContent,
    tokensUsed: llmResult.tokensUsed,
    model: llmResult.model,
    toolCalls: llmResult.toolCalls,
    toolResults,
    replySent: replyResult.success,
    safetyPassed,
  } satisfies SessionResult;
});
