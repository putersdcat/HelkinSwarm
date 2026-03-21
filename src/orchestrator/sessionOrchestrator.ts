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
import type { SendConfirmationCardInput, SendConfirmationCardResult } from './sendConfirmationCardActivity.js';
import type { StoreMemoryInput } from './storeMemoryActivity.js';
import type { SubAgentInput, SubAgentResult } from './subAgentActivity.js';
import type { ExecutorInput, ExecutorResult } from './executorActivity.js';
import { signExecutorPayload, hashPayload } from './executorActivity.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { canonicalizeInput } from './inputCanonicalizer.js';

export interface SessionInput {
  state: OverseerState;
  userMessage: string;
  conversationReference: Partial<ConversationReference>;
  correlationId: string;
  /** Optional model override for /heavy and /light slash commands. */
  modelOverride?: 'primary' | 'secondary';
  /** Image URLs extracted from Teams attachments (#130) */
  imageUrls?: string[];
}

export interface SessionResult {
  response: string;
  tokensUsed: number;
  /** Prompt tokens sent TO the model (context pressure metric). Fix: #137 */
  promptTokens: number;
  model: string;
  toolCalls: Array<{ name: string; arguments: string }>;
  toolResults: ToolDispatchResult | null;
  replySent: boolean;
  safetyPassed: boolean;
}

df.app.orchestration('sessionOrchestrator', function* (context) {
  const input: SessionInput = context.df.getInput() as SessionInput;
  const correlationId = input.correlationId ?? crypto.randomUUID();

  // 0. Canonicalize user input (#138)
  const { text: canonicalizedMessage } = canonicalizeInput(input.userMessage);

  // 1. Build prompt (persona + summary + user message)
  const promptInput: BuildPromptInput = {
    state: input.state,
    userMessage: canonicalizedMessage,
  };
  const prompt: PromptResult = yield context.df.callActivity(
    'buildPromptActivity',
    promptInput,
  );

  // 2. Call LLM (global frontier model via Foundry client)
  const llmResult: LlmResult = yield context.df.callActivity(
    'llmActivity',
    { ...prompt, correlationId, modelOverride: input.modelOverride, imageUrls: input.imageUrls },
  );

  // 3. If LLM returned tool calls, run the safety pipeline
  let toolResults: ToolDispatchResult | null = null;
  let safetyPassed = true;
  let responseContent = llmResult.content;

  if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
    // Determine aggregate risk from the tool registry
    const isLowRiskOnly = llmResult.toolCalls.every((tc: { name: string }) => {
      const def = toolRegistry.get(tc.name);
      return def?.risk === 'low';
    });

    if (!isLowRiskOnly) {
      // Determine the highest risk level among requested tools
      const highestRisk = llmResult.toolCalls.some((tc: { name: string }) =>
        toolRegistry.get(tc.name)?.risk === 'high') ? 'high' as const : 'medium' as const;

      // Run pre-execution verification pipeline (steps 1-4: schema, data min, spot check, shields)
      const verification = yield context.df.callActivity('verificationPipelineActivity', {
        correlationId,
        sessionId: input.state.userId,
        userId: input.state.userId,
        toolName: llmResult.toolCalls.map((tc: { name: string }) => tc.name).join(', '),
        risk: highestRisk,
        rawOutput: llmResult.toolCalls,
        originalQuery: input.userMessage,
      });

      if (!verification.passed && !verification.requiresConfirmation) {
        // Hard block from safety pipeline (prompt shields, schema validation, etc.)
        responseContent = `Safety pipeline blocked this action: ${verification.error}`;
        safetyPassed = false;
      } else if (verification.requiresConfirmation) {
        // Steps 1-4 passed but human confirmation required for medium/high risk
        const cardInput: SendConfirmationCardInput = {
          userId: input.state.userId,
          toolName: llmResult.toolCalls.map((tc: { name: string }) => tc.name).join(', '),
          risk: highestRisk,
          description: `Execute ${llmResult.toolCalls.length} tool(s): ${llmResult.toolCalls.map((tc: { name: string }) => tc.name).join(', ')}`,
          correlationId,
          sessionInstanceId: context.df.instanceId,
        };
        const cardResult: SendConfirmationCardResult = yield context.df.callActivity(
          'sendConfirmationCardActivity',
          cardInput,
        );

        if (cardResult.sent) {
          // Race: wait for human response OR 5-minute timeout
          const timeoutMs = 5 * 60 * 1000;
          const deadline = new Date(context.df.currentUtcDateTime.getTime() + timeoutMs);
          const timer = context.df.createTimer(deadline);
          const confirmation = context.df.waitForExternalEvent('ConfirmationResponse');

          const winner = yield context.df.Task.any([confirmation, timer]);

          if (winner === timer) {
            responseContent = `⏰ Action timed out after 5 minutes. The tool call was cancelled for safety.`;
            safetyPassed = false;
          } else {
            timer.cancel();
            const response = confirmation.result as { action: string };
            if (response.action !== 'approved') {
              responseContent = `❌ Action cancelled by user.`;
              safetyPassed = false;
            }
          }
        } else {
          responseContent = `Safety: Unable to send confirmation card. Action blocked.`;
          safetyPassed = false;
        }
      }
      // If verification.passed && !requiresConfirmation: proceed (full-destructive mode)
    }

    if (safetyPassed) {
      // Split tool calls: sub-agent isolated vs direct dispatch (#47)
      const subAgentCalls: typeof llmResult.toolCalls = [];
      const directCalls: typeof llmResult.toolCalls = [];

      for (const tc of llmResult.toolCalls) {
        const def = toolRegistry.get(tc.name);
        if (def?.requiresSubAgent) {
          subAgentCalls.push(tc);
        } else {
          directCalls.push(tc);
        }
      }

      // Run sub-agent isolated tool calls (fresh LLM session, secondary model)
      const subAgentResults: ToolDispatchResult['results'] = [];
      for (const tc of subAgentCalls) {
        const def = toolRegistry.get(tc.name);
        const subInput: SubAgentInput = {
          toolName: tc.name,
          toolDescription: def?.description ?? tc.name,
          toolInputSchema: def?.inputSchema,
          arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
          userContext: input.userMessage,
          correlationId,
          sessionId: input.state.userId,
          userId: input.state.userId,
        };
        const subResult: SubAgentResult = yield context.df.callActivity('subAgentActivity', subInput);
        subAgentResults.push({
          toolCallId: tc.id,
          toolName: tc.name,
          success: subResult.success,
          result: subResult.output,
          error: subResult.error,
          requiresExecutor: false,
        });
      }

      // Run direct-dispatch tool calls (handler only, no LLM)
      let directResults: ToolDispatchResult | null = null;
      if (directCalls.length > 0) {
        const dispatchInput: ToolDispatchInput = {
          toolCalls: directCalls,
          correlationId,
          sessionId: input.state.userId,
          userId: input.state.userId,
        };
        directResults = yield context.df.callActivity('toolDispatchActivity', dispatchInput);
      }

      // Merge results
      const mergedResults: ToolDispatchResult['results'] = [
        ...subAgentResults,
        ...(directResults?.results ?? []),
      ];

      // Execute high-risk tools through the executor activity (#58)
      // These were flagged by toolDispatchActivity as requiresExecutor
      for (let i = 0; i < mergedResults.length; i++) {
        const r = mergedResults[i];
        if (!r.requiresExecutor) continue;

        const tc = llmResult.toolCalls.find((t: { id: string }) => t.id === r.toolCallId);
        if (!tc) continue;

        const parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;
        const pHash = hashPayload(parsedArgs);
        const signature = signExecutorPayload(input.state.userId, tc.name, pHash);

        const execInput: ExecutorInput = {
          action: inferAction(tc.name),
          toolName: tc.name,
          signedPayload: signature,
          payloadHash: pHash,
          correlationId,
          sessionId: input.state.userId,
          userId: input.state.userId,
          targetResource: toolRegistry.get(tc.name)?.handlerModule ?? 'unknown',
          arguments: parsedArgs,
        };
        const execResult: ExecutorResult = yield context.df.callActivity('executorActivity', execInput);
        mergedResults[i] = {
          toolCallId: r.toolCallId,
          toolName: r.toolName,
          success: execResult.success,
          result: execResult.result,
          error: execResult.error,
          requiresExecutor: true,
        };
      }

      toolResults = {
        results: mergedResults,
        totalCalls: mergedResults.length,
      };

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

  // 6. Store conversation turn in vector memory (non-blocking, best-effort) (#134)
  const memoryInput: StoreMemoryInput = {
    userId: input.state.userId,
    userMessage: input.userMessage,
    assistantReply: responseContent,
  };
  yield context.df.callActivity('storeMemoryActivity', memoryInput);

  return {
    response: responseContent,
    tokensUsed: llmResult.tokensUsed,
    promptTokens: llmResult.promptTokens,
    model: llmResult.model,
    toolCalls: llmResult.toolCalls,
    toolResults,
    replySent: replyResult.success,
    safetyPassed,
  } satisfies SessionResult;
});

// ---------------------------------------------------------------------------
// Helper: infer the executor action type from the tool name (#58)
// ---------------------------------------------------------------------------
function inferAction(toolName: string): ExecutorInput['action'] {
  if (toolName.includes('delete') || toolName.includes('remove')) return 'delete';
  if (toolName.includes('move') || toolName.includes('archive')) return 'move';
  if (toolName.includes('create') || toolName.includes('send') || toolName.includes('write')) return 'create';
  return 'admin';
}
