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
import type { PlanInput, PlanResult } from './planActivity.js';
import { canonicalizeInput } from './inputCanonicalizer.js';
import { computeToolBudget } from './toolBudgetScaler.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import type { QuotedContext } from '../bot/quotedContext.js';
import { buildModelOverrideDisclosure, formatTelemetryFooter } from './turnTelemetry.js';
import type { TurnTelemetryData, TelemetrySpan } from './turnTelemetry.js';
import { getEnvConfig } from '../config/envConfig.js';

export interface SessionInput {
  state: OverseerState;
  userMessage: string;
  conversationReference: Partial<ConversationReference>;
  correlationId: string;
  /** Optional model override: 'primary', 'secondary', or a direct deployment name (#217). */
  modelOverride?: string;
  /** Image URLs extracted from Teams attachments (#130) */
  imageUrls?: string[];
  /** Parsed DevLoop protocol context (#147) */
  devLoopContext?: DevLoopContext;
  /** Structured quoted-reply context from Teams reply-with-quote (#278) */
  quotedContext?: QuotedContext;
  /** Override for multi-round tool dispatch limit. Defaults to 5, max 10. (#253) */
  toolBudget?: number;
}

export interface SessionResult {
  response: string;
  /** LLM output without model-disclosure prefix or telemetry — safe for recentHistory. */
  cleanResponse: string;
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
  const turnStartTime = context.df.currentUtcDateTime.getTime();

  // 0. Canonicalize user input (#138)
  const { text: canonicalizedMessage } = canonicalizeInput(input.userMessage);

  // 0b. For DevLoop sessions, use the clean body (protocol markers stripped) as
  // the user message for the LLM — the DevLoop context is injected via system prompt (#147).
  const userMessageForLlm = input.devLoopContext?.isDevLoop
    ? input.devLoopContext.body
    : canonicalizedMessage;

  // 1. Build prompt (persona + summary + user message)
  const promptInput: BuildPromptInput = {
    state: input.state,
    userMessage: userMessageForLlm,
    devLoopContext: input.devLoopContext,
    quotedContext: input.quotedContext,
    correlationId,
  };
  let spanStart = context.df.currentUtcDateTime.getTime();
  const prompt: PromptResult = yield context.df.callActivity(
    'buildPromptActivity',
    promptInput,
  );
  const spans: TelemetrySpan[] = [];
  spans.push({ label: 'prompt', durationMs: context.df.currentUtcDateTime.getTime() - spanStart });

  // 1b. Plan activity — classify complexity & decompose multi-step requests (#320)
  // Simple requests skip the LLM planning call (zero overhead).
  spanStart = context.df.currentUtcDateTime.getTime();
  const planInput: PlanInput = {
    userMessage: userMessageForLlm,
    correlationId,
    userId: input.state.userId,
    availableToolNames: toolRegistry.getToolNames(),
  };
  const planResult: PlanResult = yield context.df.callActivity('planActivity', planInput);
  if (planResult.planTokensUsed > 0) {
    spans.push({ label: 'plan', durationMs: context.df.currentUtcDateTime.getTime() - spanStart });
  }

  // Inject plan guidance into prompt messages for compound/complex requests (#320)
  const promptWithPlan: PromptResult = planResult.steps
    ? {
        ...prompt,
        messages: [
          ...prompt.messages,
          {
            role: 'system' as const,
            content: `[Plan] Complexity: ${planResult.complexity}. Execute these steps in order:\n${planResult.steps.map(s => `${s.order}. ${s.description}${s.toolHint ? ` (use ${s.toolHint})` : ''}`).join('\n')}`,
          },
        ],
      }
    : prompt;

  // 2. Call LLM (global frontier model via Foundry client)
  spanStart = context.df.currentUtcDateTime.getTime();
  const llmResult: LlmResult = yield context.df.callActivity(
    'llmActivity',
    { ...promptWithPlan, correlationId, userId: input.state.userId, modelOverride: input.modelOverride, imageUrls: input.imageUrls },
  );
  spans.push({ label: 'llm', durationMs: context.df.currentUtcDateTime.getTime() - spanStart });

  // Cumulative token tracking across all LLM calls in this session (#253)
  let cumulativeTokensUsed = llmResult.tokensUsed + planResult.planTokensUsed;
  let cumulativePromptTokens = llmResult.promptTokens;
  const operationalNotices = new Set(llmResult.operationalNotices ?? []);

  // Counters for telemetry footer (#321)
  let subAgentSpawnCount = 0;

  // 3. If LLM returned tool calls, run the safety pipeline
  let toolResults: ToolDispatchResult | null = null;
  let safetyPassed = true;
  let responseContent = llmResult.content;

  if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
    // Compute adaptive tool budget (#139)
    const domains = new Set(
      llmResult.toolCalls.map((tc: { name: string }) => {
        // Derive domain from tool name convention: "domain_verb_noun"
        const parts = tc.name.split('_');
        return parts.length > 1 ? parts[0] : 'core';
      }),
    );
    const { budget } = computeToolBudget({
      userMessage: canonicalizedMessage,
      historyLength: input.state.turnCount ?? 0,
      domainCount: domains.size,
    });

    // Truncate tool calls to the adaptive budget
    const toolCallsForDispatch = llmResult.toolCalls.slice(0, budget);

    // Determine aggregate risk from the tool registry
    const isLowRiskOnly = toolCallsForDispatch.every((tc: { name: string }) => {
      const def = toolRegistry.get(tc.name);
      return def?.risk === 'low';
    });

    // Any tool with declarative requiresConfirmation must trigger the pipeline regardless of risk (#247)
    const anyDeclarativeConfirmation = toolCallsForDispatch.some((tc: { name: string }) =>
      toolRegistry.get(tc.name)?.requiresConfirmation === true,
    );

    // Per-tool opt-out: if ALL tools in the batch have requiresConfirmation:false,
    // skip the confirmation card even for medium/high risk (#302).
    const allToolsSkipConfirmation = toolCallsForDispatch.every((tc: { name: string }) =>
      toolRegistry.get(tc.name)?.requiresConfirmation === false,
    );

    // Capture verified-set data from the safety pipeline for executor binding (#266)
    let verifiedSetHash: string | undefined;
    let verifiedAt: string | undefined;

    if (!isLowRiskOnly || anyDeclarativeConfirmation) {
      // Determine the highest risk level among requested tools
      const highestRisk = toolCallsForDispatch.some((tc: { name: string }) =>
        toolRegistry.get(tc.name)?.risk === 'high') ? 'high' as const : 'medium' as const;

      // Run pre-execution verification pipeline (steps 1-4: schema, data min, spot check, shields)
      const verification = yield context.df.callActivity('verificationPipelineActivity', {
        correlationId,
        sessionId: input.state.userId,
        userId: input.state.userId,
        toolName: toolCallsForDispatch.map((tc: { name: string }) => tc.name).join(', '),
        risk: highestRisk,
        rawOutput: toolCallsForDispatch,
        originalQuery: input.userMessage,
        skipConfirmation: allToolsSkipConfirmation,
      });

      // Capture verified-set binding from pipeline result (#266)
      verifiedSetHash = verification.verifiedSetHash as string | undefined;
      verifiedAt = verification.verifiedSet?.verifiedAt as string | undefined;

      if (!verification.passed && !verification.requiresConfirmation) {
        // Hard block from safety pipeline (prompt shields, schema validation, etc.)
        responseContent = `Safety pipeline blocked this action: ${verification.error}`;
        safetyPassed = false;
      } else if (verification.requiresConfirmation) {
        // Steps 1-4 passed but human confirmation required for medium/high risk
        const cardInput: SendConfirmationCardInput = {
          userId: input.state.userId,
          toolName: toolCallsForDispatch.map((tc: { name: string }) => tc.name).join(', '),
          risk: highestRisk,
          description: `Execute ${toolCallsForDispatch.length} tool(s): ${toolCallsForDispatch.map((tc: { name: string }) => tc.name).join(', ')}`,
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
      const toolDispatchStart = context.df.currentUtcDateTime.getTime();
      const subAgentCalls: typeof toolCallsForDispatch = [];
      const directCalls: typeof toolCallsForDispatch = [];

      for (const tc of toolCallsForDispatch) {
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
        subAgentSpawnCount++;
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
          conversationId: input.state.conversationId,
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

        const tc = toolCallsForDispatch.find((t: { id: string }) => t.id === r.toolCallId);
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
          // Bind to canonical verified set from verification pipeline (#266)
          verifiedSetHash,
          verifiedAt,
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
      spans.push({ label: 'tools', durationMs: context.df.currentUtcDateTime.getTime() - toolDispatchStart });

      // 3b. Multi-round tool dispatch loop (#253)
      // The LLM can request additional tool calls after seeing results,
      // enabling chained reasoning (e.g. "find my latest email, then forward it").
      // Max rounds from toolBudget or default 5, capped at 10.
      const maxToolRounds = Math.min(input.toolBudget ?? 5, 10);
      const allToolSchemas = toolRegistry.toFunctionSchemas();
      const initialResultCount = mergedResults.length;

      const followUpInput: LlmFollowUpInput = {
        originalMessages: prompt.messages,
        assistantToolCallMessage: {
          content: llmResult.content,
          toolCalls: toolCallsForDispatch,
        },
        toolResults: toolResults?.results ?? [],
        correlationId,
        modelOverride: input.modelOverride,
        enableRetry: true,
        tools: allToolSchemas,
      };
      spanStart = context.df.currentUtcDateTime.getTime();
      let followUp: LlmResult = yield context.df.callActivity('llmFollowUpActivity', followUpInput);
      cumulativeTokensUsed += followUp.tokensUsed;
      cumulativePromptTokens += followUp.promptTokens;
      for (const notice of followUp.operationalNotices ?? []) {
        operationalNotices.add(notice);
      }

      // Multi-round loop: if the follow-up LLM requests more tool calls,
      // dispatch them and call the LLM again. This replaces the old 2-iteration
      // retry loop with a full multi-round mechanism. (#253, supersedes #182)
      let toolRound = 0;
      const additionalTurns: LlmFollowUpInput['additionalTurns'] = [];

      while (
        followUp.toolCalls &&
        followUp.toolCalls.length > 0 &&
        toolRound < maxToolRounds
      ) {
        toolRound++;

        // Handle finish_reason: "length" with empty content — model was truncated mid-tool-call (#253)
        if (followUp.finishReason === 'length' && (!followUp.content || !followUp.content.trim())) {
          console.log(`[sessionOrchestrator] Round ${toolRound}: finish_reason=length, retrying with concise hint (#253)`);
          additionalTurns.push({
            assistantContent: followUp.content || '',
            assistantToolCalls: [],
            toolResults: [],
          });
          // Force a text response by not passing tools on the retry
          const truncRetryInput: LlmFollowUpInput = {
            originalMessages: prompt.messages,
            assistantToolCallMessage: {
              content: llmResult.content,
              toolCalls: toolCallsForDispatch,
            },
            toolResults: toolResults?.results.slice(0, initialResultCount) ?? [],
            correlationId,
            modelOverride: input.modelOverride,
            enableRetry: false,
            additionalTurns: [
              ...additionalTurns,
              {
                assistantContent: '',
                assistantToolCalls: [],
                toolResults: [{
                  toolCallId: 'truncation-hint',
                  toolName: 'system',
                  success: true,
                  result: 'Your previous response was truncated because it was too long. Please answer more concisely — use plain text, no tool calls.',
                }],
              },
            ],
          };
          followUp = yield context.df.callActivity('llmFollowUpActivity', truncRetryInput);
          cumulativeTokensUsed += followUp.tokensUsed;
          cumulativePromptTokens += followUp.promptTokens;
          for (const notice of followUp.operationalNotices ?? []) {
            operationalNotices.add(notice);
          }
          break; // Truncation retry is terminal — don't loop further
        }

        console.log(
          `[sessionOrchestrator] Multi-round ${toolRound}/${maxToolRounds}: ` +
          `dispatching ${followUp.toolCalls.length} tool call(s) (#253)`,
        );

        // Allow low + medium risk tools in multi-round; block high-risk / executor (#319)
        const roundCallsForDispatch = followUp.toolCalls.filter(
          (tc: { name: string }) => {
            const def = toolRegistry.get(tc.name);
            return def && def.risk !== 'high' && !def.requiresExecutor;
          },
        );

        if (roundCallsForDispatch.length === 0) break;

        // Lightweight verification for medium-risk tools in multi-round (#319)
        const hasMediumRisk = roundCallsForDispatch.some(
          (tc: { name: string }) => toolRegistry.get(tc.name)?.risk === 'medium',
        );
        if (hasMediumRisk) {
          const roundVerification = yield context.df.callActivity('verificationPipelineActivity', {
            correlationId,
            sessionId: input.state.userId,
            userId: input.state.userId,
            toolName: roundCallsForDispatch.map((tc: { name: string }) => tc.name).join(', '),
            risk: 'medium' as const,
            rawOutput: roundCallsForDispatch,
            originalQuery: input.userMessage,
            skipConfirmation: true, // No human card in multi-round — schema + shields only
          });
          if (!roundVerification.passed) {
            console.log(`[sessionOrchestrator] Multi-round ${toolRound}: verification blocked medium-risk tools`);
            break;
          }
        }

        // Split into sub-agent vs direct dispatch (same as initial dispatch) (#319)
        const roundSubAgentCalls: typeof roundCallsForDispatch = [];
        const roundDirectCalls: typeof roundCallsForDispatch = [];
        for (const tc of roundCallsForDispatch) {
          const def = toolRegistry.get(tc.name);
          if (def?.requiresSubAgent) {
            roundSubAgentCalls.push(tc);
          } else {
            roundDirectCalls.push(tc);
          }
        }

        // Execute sub-agent calls (#319)
        const roundSubResults: ToolDispatchResult['results'] = [];
        for (const tc of roundSubAgentCalls) {
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
          subAgentSpawnCount++;
          roundSubResults.push({
            toolCallId: tc.id,
            toolName: tc.name,
            success: subResult.success,
            result: subResult.output,
            error: subResult.error,
            requiresExecutor: false,
          });
          console.log(`[sessionOrchestrator] Multi-round ${toolRound}: sub-agent spawn for ${tc.name} (#319)`);
        }

        // Execute direct-dispatch calls
        let roundDirectResults: ToolDispatchResult | null = null;
        if (roundDirectCalls.length > 0) {
          const roundDispatchInput: ToolDispatchInput = {
            toolCalls: roundDirectCalls,
            correlationId,
            sessionId: input.state.userId,
            userId: input.state.userId,
            conversationId: input.state.conversationId,
          };
          roundDirectResults = yield context.df.callActivity(
            'toolDispatchActivity',
            roundDispatchInput,
          );
        }

        // Merge round results
        const roundResults: ToolDispatchResult = {
          results: [...roundSubResults, ...(roundDirectResults?.results ?? [])],
          totalCalls: roundSubResults.length + (roundDirectResults?.results.length ?? 0),
        };

        // Accumulate this turn for conversation history
        additionalTurns.push({
          assistantContent: followUp.content,
          assistantToolCalls: roundCallsForDispatch,
          toolResults: roundResults.results,
        });

        // Accumulate into overall tool results for telemetry
        toolResults.results.push(...roundResults.results);
        toolResults.totalCalls += roundResults.results.length;

        // On the last allowed round, don't pass tools — force a text response
        const isLastRound = toolRound >= maxToolRounds;

        // Call follow-up again with full conversation history
        const roundFollowUpInput: LlmFollowUpInput = {
          originalMessages: prompt.messages,
          assistantToolCallMessage: {
            content: llmResult.content,
            toolCalls: toolCallsForDispatch,
          },
          toolResults: toolResults?.results.slice(0, initialResultCount) ?? [],
          correlationId,
          modelOverride: input.modelOverride,
          enableRetry: !isLastRound,
          tools: !isLastRound ? allToolSchemas : undefined,
          additionalTurns,
        };
        followUp = yield context.df.callActivity('llmFollowUpActivity', roundFollowUpInput);
        cumulativeTokensUsed += followUp.tokensUsed;
        cumulativePromptTokens += followUp.promptTokens;
        for (const notice of followUp.operationalNotices ?? []) {
          operationalNotices.add(notice);
        }
      }

      responseContent = followUp.content;
      spans.push({ label: 'followup', durationMs: context.df.currentUtcDateTime.getTime() - spanStart });
    }
  }

  // 4. Guard against empty response — Teams rejects empty text
  if (!responseContent || responseContent.trim().length === 0) {
    responseContent = 'I processed your request but have nothing to report back.';
  }

  // 5. Send reply to Teams (proactive)
  // For DevLoop sessions, wrap the response in protocol format (#147, #92)
  const cleanResponse = responseContent; // Preserve pre-decoration LLM output for recentHistory
  const displayResponse = operationalNotices.size > 0
    ? `${Array.from(operationalNotices).join('\n')}\n\n${responseContent}`
    : responseContent;
  let replyMessage = displayResponse;

  const modelDisclosure = buildModelOverrideDisclosure(input.modelOverride, llmResult.model);
  if (modelDisclosure) {
    replyMessage = `${modelDisclosure}\n\n${replyMessage}`;
  }

  // 5a. Append debug telemetry footer (#174, #254, spec: 0n)
  // Always appended — even in 'off' mode, a correlation ID suffix is shown.
  const envConfig = getEnvConfig();
  {
    const turnEndTime = context.df.currentUtcDateTime.getTime();
    const toolNames: string[] = toolResults?.results?.map(
      (r: { toolName: string }) => r.toolName,
    ) ?? [];

    const telemetryData: TurnTelemetryData = {
      correlationId,
      totalMs: turnEndTime - turnStartTime,
      model: llmResult.model,
      promptTokens: cumulativePromptTokens,
      completionTokens: cumulativeTokensUsed - cumulativePromptTokens,
      spans,
      toolCalls: toolNames,
      safetyPassed,
      planComplexity: planResult.complexity,
      subAgentCount: subAgentSpawnCount > 0 ? subAgentSpawnCount : undefined,
    };
    replyMessage += formatTelemetryFooter(envConfig.devTelemetryMode, telemetryData);
  }

  if (input.devLoopContext?.isDevLoop) {
    const tag = input.devLoopContext.correlationTag ? ` ${input.devLoopContext.correlationTag}` : '';
    // Use HELKIN-REPLY for interrogation queries, SWARM for steering messages (#92)
    const replyPrefix = input.devLoopContext.prefix === 'DEVQUERY' ? 'HELKIN-REPLY' : 'SWARM';
    replyMessage = `${replyPrefix}: ${replyMessage}${tag} OVER`;
  }

  const replyInput: SendReplyInput = {
    userId: input.state.userId,
    message: replyMessage,
    correlationId,
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
    response: displayResponse,
    cleanResponse,
    tokensUsed: cumulativeTokensUsed,
    promptTokens: cumulativePromptTokens,
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
