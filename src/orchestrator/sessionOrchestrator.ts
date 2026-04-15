// Session sub-orchestrator — handles one complete turn.
// Loads prompt, calls LLM, dispatches tools through the safety pipeline, returns result.
// Spec ref: 08-Orchestrator-Patterns.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import { z } from 'zod';
import type { OverseerState } from './stateManager.js';
import type { BuildPromptInput, PromptResult } from './buildPromptActivity.js';
import type { LlmActivityInput, LlmResult } from './llmActivity.js';
import type { SendReplyInput, SendReplyResult } from './sendReplyActivity.js';
import type { ConversationReference } from 'botbuilder';
import type { SteeringInjectionResult } from './steeringInjectionActivity.js';
import type { EmitOrchestratorTelemetryInput } from './emitOrchestratorTelemetryActivity.js';

import type { ToolDispatchInput, ToolDispatchResult } from './toolDispatchActivity.js';
import type { LlmFollowUpInput } from './llmFollowUpActivity.js';
import type { SendConfirmationCardInput, SendConfirmationCardResult } from './sendConfirmationCardActivity.js';
import type { SaveStateInput } from './saveStateActivity.js';
import type { SubAgentInput, SubAgentResult } from './subAgentActivity.js';
import type { ExecutorInput, ExecutorResult } from './executorActivity.js';
import { signExecutorPayload, hashPayload } from './executorActivity.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { applyModelProfileToFunctionSchemas } from '../tools/toolRegistry.js';
import { buildSuccessfulFailoverNotices } from '../llm/foundryClient.js';
import { recoverOperationalNoticesFromTrace } from './failoverNoticeRecovery.js';
import type { PlanInput, PlanResult } from './planActivity.js';
import type { SwarmDecomposerInput, SwarmDecomposerResult, SwarmOrchestratorInput, SwarmOrchestratorResult } from './swarm/swarmTypes.js';
import type { PersistSwarmResultInput } from './swarm/persistSwarmResultActivity.js';
import { getExecutableToolNames } from '../capabilities/capabilityLoader.js';
import { canonicalizeInput } from './inputCanonicalizer.js';
import { computeToolBudget, DEFAULT_PER_TOOL_TURN_CAP, PER_TOOL_CAP_EXCEEDED_MESSAGES, PER_TOOL_TURN_CAPS } from './toolBudgetScaler.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import type { QuotedContext } from '../bot/quotedContext.js';
import { buildModelOverrideDisclosure, formatTelemetryFooter } from './turnTelemetry.js';
import type { TurnTelemetryData, TelemetrySpan } from './turnTelemetry.js';
import type { RuntimeAssetReference } from '../integrations/runtimeAssetStore.js';
import { getModelForTask, getModelRouting } from '../llm/modelRouter.js';
import {
  canExecuteInMultiRound,
  getHighestMultiRoundRisk,
  shouldSkipConfirmationForMultiRound,
} from './multiRoundPolicy.js';
import {
  collectCompletedPlanStepOrders,
  resolveExecutionHint,
  selectReadyToolCallsByPlan,
  sortToolCallsByPlan,
} from './planExecutionHints.js';
import {
  buildCapExceededToolResult,
  buildDuplicateReplayedToolResult,
  buildDuplicateSuppressedToolResult,
  buildToolCallFingerprint,
  isMutatingTool,
  isReplayableReadOnlyTool,
  recordSuccessfulReplayableReadOnlyResults,
  recordSuccessfulMutatingFingerprints,
} from './toolCallGuards.js';
import {
  buildContextAwareRoutingMessage,
  buildReadOnlyDiscoveryQuery,
  buildReadOnlyDiscoveryResponse,
  buildDeterministicExactToolResponse,
  buildDiscoveryDeadEndResponse,
  deriveContextAwareInitialToolSchemas,
  deriveSelectiveFollowUpToolSchemas,
  getDiscoveryFollowUpModelOverride,
  getForcedInitialToolChoice,
  getForcedDiscoveryFollowUpToolChoice,
  getDiscoveryFirstToolSchemas,
  isReadOnlyDiscoveryRequest,
  isDiscoveryOnlyDeadEnd,
  parseExactReplyInstruction,
  synthesizeRuntimeAssetInlineEmailToolCall,
  synthesizeDeterministicReadOnlyInitialToolCall,
  synthesizeExactToolCall,
  synthesizeDeterministicFollowUpToolCall,
  deriveLocatorUrlFetchCall,
  deriveWebInteractDealerLocatorCall,
  stripValidationNoise,
} from './discoveryToolInjection.js';
import { buildRecentRequestRecallResponse } from './autobiographicalReflex.js';
import {
  detectClarificationRequest,
  resolveClarificationAnswer,
  type PendingClarification,
} from './clarificationLoop.js';

function* emitOrchestratorTelemetry(
  context: df.OrchestrationContext,
  input: EmitOrchestratorTelemetryInput,
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Durable Functions generator helper
): Generator<df.Task, void, any> {
  yield context.df.callActivity('emitOrchestratorTelemetryActivity', input);
}

/**
 * Maximum time to wait for a follow-up LLM activity via Durable timer (#588).
 * Using a Durable-state-machine timer (not JS setTimeout) guarantees this fires
 * even when the activity worker's event loop is busy or JS timers are suppressed.
 */
const FOLLOWUP_DURABLE_TIMEOUT_MS = 100_000; // 100s = 90s LLM budget + 10s overhead

/**
 * Maximum time to wait for a sub-agent activity via Durable timer (#591).
 * Uses Durable timer (not JS setTimeout) because JS timers are unreliable
 * in Azure Container Apps activity workers (#588).
 */
const SUB_AGENT_DURABLE_TIMEOUT_MS = 90_000; // 90s hard Durable cap

// SWARM_ENABLED is now read inside planActivity (activity-safe env read)
// and returned as planResult.swarmEnabled. This is deterministic during
// Durable Functions replay because activity outputs are replayed from history.

/**
 * Race llmFollowUpActivity against a Durable timer (#588).
 * If the timer fires first, the orchestrator receives a synthetic timeout result
 * and moves on — the abandoned activity completes in the background harmlessly.
 */
function* withLlmFollowUpTimeout(
  context: df.OrchestrationContext,
  input: LlmFollowUpInput,
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Durable Functions generator helper
): Generator<df.Task, LlmResult, any> {
  const timer = context.df.createTimer(
    new Date(context.df.currentUtcDateTime.getTime() + FOLLOWUP_DURABLE_TIMEOUT_MS),
  );
  const task = context.df.callActivity('llmFollowUpActivity', input);
  const winner = yield context.df.Task.any([task, timer]) as df.Task;
  if (winner === timer) {
    console.error(
      `[sessionOrchestrator] llmFollowUpActivity timed out after ${FOLLOWUP_DURABLE_TIMEOUT_MS}ms` +
      ' via Durable timer — JS timers unreliable in this env (#588)',
    );
    return {
      content: '⚡ Response generation timed out. Please try again.',
      model: 'timeout',
      tokensUsed: 0,
      promptTokens: 0,
      toolCalls: [],
      finishReason: 'error',
      operationalNotices: ['llmFollowUpActivity timed out via Durable timer'],
      failoverSteps: [],
    };
  }
  timer.cancel();
  return task.result as LlmResult;
}

/**
 * Race subAgentActivity against a Durable timer (#591).
 * If the timer fires first, the orchestrator receives a synthetic timeout result
 * and moves on — the abandoned activity completes in the background harmlessly.
 */
function* withSubAgentTimeout(
  context: df.OrchestrationContext,
  input: SubAgentInput,
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Durable Functions generator helper
): Generator<df.Task, SubAgentResult, any> {
  const timer = context.df.createTimer(
    new Date(context.df.currentUtcDateTime.getTime() + SUB_AGENT_DURABLE_TIMEOUT_MS),
  );
  const task = context.df.callActivity('subAgentActivity', input);
  const winner = yield context.df.Task.any([task, timer]) as df.Task;
  if (winner === timer) {
    console.error(
      `[sessionOrchestrator] subAgentActivity timed out after ${SUB_AGENT_DURABLE_TIMEOUT_MS}ms` +
      ` via Durable timer — tool: ${input.toolName} (#591)`,
    );
    return {
      success: false,
      model: 'timeout',
      output: undefined,
      error: `subAgentActivity timed out after ${SUB_AGENT_DURABLE_TIMEOUT_MS}ms`,
      tokensUsed: 0,
      correlationId: input.correlationId,
    };
  }
  timer.cancel();
  return task.result as SubAgentResult;
}

const ConfirmationResponseSchema = z.object({
  action: z.enum(['approved', 'denied']),
  correlationId: z.string().min(1),
  toolName: z.string().min(1),
  userId: z.string().min(1),
  sessionInstanceId: z.string().min(1),
  respondedAt: z.string().min(1).optional(),
});

type ConfirmationResponse = z.infer<typeof ConfirmationResponseSchema>;

function isMatchingConfirmationResponse(
  response: ConfirmationResponse,
  expected: { correlationId: string; toolName: string; userId: string; sessionInstanceId: string },
): boolean {
  return response.correlationId === expected.correlationId
    && response.toolName === expected.toolName
    && response.userId === expected.userId
    && response.sessionInstanceId === expected.sessionInstanceId;
}

export interface SessionInput {
  state: OverseerState;
  userMessage: string;
  /** Fresh ingress-side snapshot of prior human turns, excluding the current message. */
  recentUserRequestsSnapshot?: string[];
  skillForgeRequest?: {
    idea: string;
  };
  conversationReference?: Partial<ConversationReference>;
  correlationId: string;
  /** Optional model override: 'primary', 'secondary', or a direct deployment name (#217). */
  modelOverride?: string;
  /** Image URLs extracted from Teams attachments (#130) */
  imageUrls?: string[];
  /** Structured runtime asset references extracted from inbound Teams attachments (#416) */
  runtimeAssets?: RuntimeAssetReference[];
  /** Prompt-safe notes about inbound attachment ingestion outcomes (#416) */
  attachmentNotices?: string[];
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
  duplicateReplaySuppressed?: boolean;
  pendingClarification?: PendingClarification | null;
}

function summarizeToolResultsForSessionResult(
  toolResults: ToolDispatchResult | null,
): ToolDispatchResult | null {
  if (!toolResults) {
    return null;
  }

  return {
    totalCalls: toolResults.totalCalls,
    results: toolResults.results.map((result) => ({
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      success: result.success,
      ...(result.error !== undefined ? { error: result.error } : {}),
      requiresExecutor: result.requiresExecutor,
      ...(result.scopedTokenMinted !== undefined ? { scopedTokenMinted: result.scopedTokenMinted } : {}),
      ...(result.scopedTokenMethod !== undefined ? { scopedTokenMethod: result.scopedTokenMethod } : {}),
      ...(result.scopedTokenScope !== undefined ? { scopedTokenScope: result.scopedTokenScope } : {}),
    })),
  };
}

function rememberOperationalEvidence(
  notices: Set<string>,
  result: Pick<LlmResult, 'operationalNotices' | 'failoverSteps'>,
): void {
  for (const notice of result.operationalNotices ?? []) {
    notices.add(notice);
  }

  for (const notice of buildSuccessfulFailoverNotices(result.failoverSteps)) {
    notices.add(notice);
  }
}

df.app.orchestration('sessionOrchestrator', function* (context) {
  const input: SessionInput = context.df.getInput() as SessionInput;
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const turnStartTime = context.df.currentUtcDateTime.getTime();
  const turnConversationId = input.conversationReference?.conversation?.id ?? input.state.conversationId;

  const duplicateReplayDetected: boolean = yield context.df.callActivity(
    'sessionReplayGuardActivity',
    {
      conversationId: turnConversationId,
      correlationId,
      userId: input.state.userId,
      sessionInstanceId: context.df.instanceId,
    },
  );

  if (duplicateReplayDetected) {
    yield* emitOrchestratorTelemetry(context, {
      name: 'PolicyOverrideApplied',
      correlationId,
      userId: input.state.userId,
      properties: {
        authority: 'post-reply-replay-suppression',
        source: 'sessionOrchestrator',
      },
    });

    return {
      response: '(duplicate replay suppressed after visible reply delivery)',
      cleanResponse: '(duplicate replay suppressed after visible reply delivery)',
      tokensUsed: 0,
      promptTokens: 0,
      model: 'duplicate-replay-suppressed',
      toolCalls: [],
      toolResults: null,
      replySent: true,
      safetyPassed: true,
      duplicateReplaySuppressed: true,
    } satisfies SessionResult;
  }

  // 0. Canonicalize user input (#138)
  const { text: canonicalizedMessage } = canonicalizeInput(input.userMessage);

  // 0b. For DevLoop sessions, use the clean body (protocol markers stripped) as
  // the user message for the LLM — the DevLoop context is injected via system prompt (#147).
  let userMessageForLlm = input.devLoopContext?.isDevLoop
    ? input.devLoopContext.body
    : canonicalizedMessage;
  userMessageForLlm = stripValidationNoise(userMessageForLlm);

  const rawUserMessageForRouting = input.devLoopContext?.isDevLoop
    ? input.devLoopContext.body
    : input.userMessage;

  const exactReplyInstruction = parseExactReplyInstruction(rawUserMessageForRouting);

  let resolvedModelOverride = input.modelOverride;
  let pendingClarificationUpdate: PendingClarification | null | undefined;
  let clarificationShortCircuitResponse: string | undefined;
  let persistClarificationClearBeforeLongRunningWork = false;

  if (input.state.pendingClarification) {
    const clarificationResult = resolveClarificationAnswer(
      input.state.pendingClarification,
      userMessageForLlm,
      context.df.currentUtcDateTime,
    );

    resolvedModelOverride = input.state.pendingClarification.modelOverride ?? resolvedModelOverride;

    if (clarificationResult.kind === 'resume') {
      pendingClarificationUpdate = null;
      persistClarificationClearBeforeLongRunningWork = true;
      userMessageForLlm = clarificationResult.resumedUserMessage;
      yield* emitOrchestratorTelemetry(context, {
        name: 'ClarificationResumed',
        correlationId,
        userId: input.state.userId,
        properties: {
          reason: input.state.pendingClarification.reason,
          requestId: input.state.pendingClarification.id,
        },
      });
    } else if (clarificationResult.kind === 'retry') {
      pendingClarificationUpdate = clarificationResult.pending;
      clarificationShortCircuitResponse = clarificationResult.responseMessage;
      yield* emitOrchestratorTelemetry(context, {
        name: 'ClarificationRetryRequested',
        correlationId,
        userId: input.state.userId,
        properties: {
          reason: clarificationResult.pending.reason,
          requestId: clarificationResult.pending.id,
        },
      });
    } else {
      pendingClarificationUpdate = null;
      clarificationShortCircuitResponse = clarificationResult.responseMessage;
      yield* emitOrchestratorTelemetry(context, {
        name: clarificationResult.kind === 'expired' ? 'ClarificationExpired' : 'ClarificationCancelled',
        correlationId,
        userId: input.state.userId,
        properties: {
          reason: input.state.pendingClarification.reason,
          requestId: input.state.pendingClarification.id,
        },
      });
    }
  } else {
    const clarificationRequest = detectClarificationRequest(
      userMessageForLlm,
      context.df.currentUtcDateTime,
      resolvedModelOverride,
    );
    if (clarificationRequest) {
      pendingClarificationUpdate = clarificationRequest.pending;
      clarificationShortCircuitResponse = clarificationRequest.responseMessage;
      yield* emitOrchestratorTelemetry(context, {
        name: 'ClarificationRequested',
        correlationId,
        userId: input.state.userId,
        properties: {
          reason: clarificationRequest.pending.reason,
          requestId: clarificationRequest.pending.id,
          answerMode: clarificationRequest.pending.answerMode,
        },
      });
    }
  }

  if (input.skillForgeRequest) {
    const prototype = yield context.df.callActivity('skillForgePrototypeActivity', {
      idea: input.skillForgeRequest.idea,
      userId: input.state.userId,
      correlationId,
    });

    const replyInput: SendReplyInput = {
      userId: input.state.userId,
      message: prototype.summary,
      correlationId,
      conversationReference: input.conversationReference,
    };
    const replyResult: SendReplyResult = yield context.df.callActivity(
      'sendReplyActivity',
      replyInput,
    );

    return {
      response: prototype.summary,
      cleanResponse: prototype.summary,
      tokensUsed: 0,
      promptTokens: 0,
      model: 'skillforge-prototype',
      toolCalls: [],
      toolResults: null,
      replySent: replyResult.success,
      safetyPassed: true,
    } satisfies SessionResult;
  }

  const spans: TelemetrySpan[] = [];
  if (exactReplyInstruction) {
    const replyInput: SendReplyInput = {
      userId: input.state.userId,
      message: exactReplyInstruction,
      correlationId,
      conversationReference: input.conversationReference,
    };
    const replyResult: SendReplyResult = yield context.df.callActivity(
      'sendReplyActivity',
      replyInput,
    );

    return {
      response: exactReplyInstruction,
      cleanResponse: exactReplyInstruction,
      tokensUsed: 0,
      promptTokens: 0,
      model: 'exact-reply-short-circuit',
      toolCalls: [],
      toolResults: null,
      replySent: replyResult.success,
      safetyPassed: true,
      pendingClarification: pendingClarificationUpdate,
    } satisfies SessionResult;
  }

  if (clarificationShortCircuitResponse) {
    let replyMessage = clarificationShortCircuitResponse;
    const telemetryMode = 'verbose' as const;
    replyMessage += formatTelemetryFooter(telemetryMode, {
      correlationId,
      totalMs: context.df.currentUtcDateTime.getTime() - turnStartTime,
      model: 'clarification-loop',
      promptTokens: 0,
      completionTokens: 0,
      spans,
      toolCalls: [],
      safetyPassed: true,
      planComplexity: 'simple',
    });

    if (input.devLoopContext?.isDevLoop) {
      const tag = input.devLoopContext.correlationTag ? ` ${input.devLoopContext.correlationTag}` : '';
      const replyPrefix = input.devLoopContext.prefix === 'DEVQUERY' ? 'HELKIN-REPLY' : 'SWARM';
      replyMessage = `${replyPrefix}: ${replyMessage}${tag} OVER`;
    }

    const replyInput: SendReplyInput = {
      userId: input.state.userId,
      message: replyMessage,
      correlationId,
      conversationReference: input.conversationReference,
    };
    const replyResult: SendReplyResult = yield context.df.callActivity(
      'sendReplyActivity',
      replyInput,
    );

    return {
      response: clarificationShortCircuitResponse,
      cleanResponse: clarificationShortCircuitResponse,
      tokensUsed: 0,
      promptTokens: 0,
      model: 'clarification-loop',
      toolCalls: [],
      toolResults: null,
      replySent: replyResult.success,
      safetyPassed: true,
      pendingClarification: pendingClarificationUpdate,
    } satisfies SessionResult;
  }

  const autobiographicalRecallHistory = (input.recentUserRequestsSnapshot?.length ?? 0) > 0
    ? input.recentUserRequestsSnapshot!.map((content) => ({ role: 'user' as const, content }))
    : input.state.recentHistory ?? [];
  const autobiographicalRecallResponse = buildRecentRequestRecallResponse(
    userMessageForLlm,
    autobiographicalRecallHistory,
  );

  if (autobiographicalRecallResponse) {
    let replyMessage = autobiographicalRecallResponse;
    const telemetryMode = 'verbose' as const;
    replyMessage += formatTelemetryFooter(telemetryMode, {
      correlationId,
      timestampIso: context.df.currentUtcDateTime.toISOString(),
      totalMs: context.df.currentUtcDateTime.getTime() - turnStartTime,
      model: 'autobiographical-recall',
      promptTokens: 0,
      completionTokens: 0,
      spans,
      toolCalls: [],
      safetyPassed: true,
      planComplexity: 'simple',
    });

    if (input.devLoopContext?.isDevLoop) {
      const tag = input.devLoopContext.correlationTag ? ` ${input.devLoopContext.correlationTag}` : '';
      const replyPrefix = input.devLoopContext.prefix === 'DEVQUERY' ? 'HELKIN-REPLY' : 'SWARM';
      replyMessage = `${replyPrefix}: ${replyMessage}${tag} OVER`;
    }

    const replyInput: SendReplyInput = {
      userId: input.state.userId,
      message: replyMessage,
      correlationId,
      conversationReference: input.conversationReference,
    };
    const replyResult: SendReplyResult = yield context.df.callActivity(
      'sendReplyActivity',
      replyInput,
    );

    return {
      response: autobiographicalRecallResponse,
      cleanResponse: autobiographicalRecallResponse,
      tokensUsed: 0,
      promptTokens: 0,
      model: 'autobiographical-recall',
      toolCalls: [],
      toolResults: null,
      replySent: replyResult.success,
      safetyPassed: true,
      pendingClarification: pendingClarificationUpdate,
    } satisfies SessionResult;
  }

  const recentAssistantText = [...input.state.recentHistory]
    .reverse()
    .find((turn) => turn.role === 'assistant')?.content;
  const recentUserText = [...input.state.recentHistory]
    .reverse()
    .find((turn) => turn.role === 'user')?.content;
  let effectiveTaskMessage = buildContextAwareRoutingMessage(userMessageForLlm, {
    quotedText: input.quotedContext?.text,
    recentUserText,
    recentAssistantText,
  });
  const isExplicitReadOnlyDiscoveryRequest = isReadOnlyDiscoveryRequest(effectiveTaskMessage);
  if (isExplicitReadOnlyDiscoveryRequest) {
    const readOnlyDiscoveryQuery = buildReadOnlyDiscoveryQuery(effectiveTaskMessage);
    yield* emitOrchestratorTelemetry(context, {
      name: 'PolicyOverrideApplied',
      correlationId,
      userId: input.state.userId,
      properties: {
        authority: 'discovery-readonly-query-rewrite',
        source: 'sessionOrchestrator',
      },
    });
    userMessageForLlm = readOnlyDiscoveryQuery;
    effectiveTaskMessage = readOnlyDiscoveryQuery;
  }

  const resolveToolSurfaceModelId = (modelOverride: string | undefined): string => {
    const routing = getModelRouting();
    const hasImages = (input.imageUrls?.length ?? 0) > 0;

    if (modelOverride === 'secondary') {
      return routing.lane.secondary;
    }

    if (modelOverride === 'primary') {
      return routing.lane.reasoning ?? routing.lane.primary;
    }

    if (modelOverride) {
      return modelOverride;
    }

    if (hasImages) {
      return getModelForTask('vision');
    }

    return routing.deploymentName;
  };

  const initialToolSurfaceModelId = resolveToolSurfaceModelId(resolvedModelOverride);
  const initialToolSurface = toolRegistry.toFunctionSchemasForModel(initialToolSurfaceModelId);
  const allToolSchemas = initialToolSurface.tools;
  const initialToolSummaryDefinitions = allToolSchemas.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
  }));

  if (initialToolSurface.wasTransformed) {
    yield* emitOrchestratorTelemetry(context, {
      name: 'ModelProfileApplied',
      correlationId,
      userId: input.state.userId,
      properties: {
        phase: 'initial',
        model: initialToolSurface.profileModel ?? initialToolSurfaceModelId,
        toolCountBefore: toolRegistry.toFunctionSchemas().length,
        toolCountAfter: allToolSchemas.length,
        excludedTools: initialToolSurface.excluded.join(','),
      },
    });
  }

  if (persistClarificationClearBeforeLongRunningWork) {
    const preConfirmationState: OverseerState = {
      ...input.state,
      pendingClarification: undefined,
    };
    yield context.df.callActivity('saveStateActivity', {
      state: preConfirmationState,
      correlationId,
    } satisfies SaveStateInput);
  }

  const steeringInjection: SteeringInjectionResult = yield context.df.callActivity(
    'steeringInjectionActivity',
    {
      state: input.state,
      userMessage: userMessageForLlm,
      correlationId,
      quotedContext: input.quotedContext,
      devLoopContext: input.devLoopContext,
    },
  );

  // 1. Build prompt (persona + summary + user message)
  const promptInput: BuildPromptInput = {
    state: input.state,
    userMessage: userMessageForLlm,
    steeringContext: steeringInjection.injectionBlock,
    conversationId: turnConversationId,
    toolSummaryDefinitions: initialToolSummaryDefinitions,
    runtimeAssets: input.runtimeAssets,
    attachmentNotices: input.attachmentNotices,
    devLoopContext: input.devLoopContext,
    quotedContext: input.quotedContext,
    correlationId,
  };
  let spanStart = context.df.currentUtcDateTime.getTime();
  const prompt: PromptResult = yield context.df.callActivity(
    'buildPromptActivity',
    promptInput,
  );
  spans.push({ label: 'prompt', durationMs: context.df.currentUtcDateTime.getTime() - spanStart });

  if (prompt.replyAlreadyDelivered) {
    yield* emitOrchestratorTelemetry(context, {
      name: 'PolicyOverrideApplied',
      correlationId,
      userId: input.state.userId,
      properties: {
        authority: 'post-reply-activity-replay-suppression',
        source: 'buildPromptActivity',
      },
    });

    return {
      response: '(duplicate replay suppressed after visible reply delivery)',
      cleanResponse: '(duplicate replay suppressed after visible reply delivery)',
      tokensUsed: 0,
      promptTokens: 0,
      model: 'duplicate-replay-suppressed',
      toolCalls: [],
      toolResults: null,
      replySent: true,
      safetyPassed: true,
      duplicateReplaySuppressed: true,
    } satisfies SessionResult;
  }

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

  // ---------------------------------------------------------------------------
  // 1c. Swarm routing — swarm-eligible requests bypass the planner's simple/compound
  // classification (#632). classifyComplexity() only checks sequential connectors
  // (then, after that, first…) which misses compound research queries like
  // "compare tradeoffs between X and Y". swarmComplexityZone is pre-computed in
  // planActivity (deterministic activity context) — using it here avoids reading
  // env vars inside the orchestrator body (Durable Functions replay safety).
  // ---------------------------------------------------------------------------
  if (
    planResult.swarmEnabled
    && planResult.swarmComplexityZone !== 'always-sequential'
    && !input.devLoopContext?.isDevLoop
    && !input.skillForgeRequest
  ) {
    // Try the swarm decomposer — use only tools with wired handlers to avoid
    // assigning agents tools that return "No handler" at runtime.
    const executableTools = getExecutableToolNames();

    // Derive active skill domains from executable tool name prefixes (#640).
    const activeSkillDomains = [...new Set(
      executableTools
        .map(name => name.split('_')[0])
        .filter((prefix): prefix is string => !!prefix && prefix !== 'helkin'),
    )];

    const decomposerInput: SwarmDecomposerInput = {
      userMessage: userMessageForLlm,
      correlationId,
      userId: input.state.userId,
      availableToolNames: executableTools,
      complexityClass: planResult.complexity,
      swarmEligibilityScore: planResult.swarmEligibilityScore,
      conversationSummary: input.state.summary || undefined,
      activeSkillDomains,
    };

    const decomposerResult: SwarmDecomposerResult = yield context.df.callActivity(
      'swarmDecomposerActivity',
      decomposerInput,
    );

    if (!decomposerResult.plan) {
      // Decomposer chose sequential fallback — log why for remote diagnosis
      yield* emitOrchestratorTelemetry(context, {
        name: 'SwarmDecomposerFallback',
        correlationId,
        userId: input.state.userId,
        properties: {
          reason: decomposerResult.fallbackReason ?? 'unknown',
          decomposerModel: decomposerResult.decomposerModel,
          tokensUsed: decomposerResult.tokensUsed,
          complexityClass: planResult.complexity,
          swarmEligibilityScore: planResult.swarmEligibilityScore,
          swarmComplexityZone: planResult.swarmComplexityZone,
        },
      });
    }

    if (decomposerResult.plan) {
      // Execute the swarm
      yield* emitOrchestratorTelemetry(context, {
        name: 'SwarmExecutionStarted',
        correlationId,
        userId: input.state.userId,
        properties: {
          agentCount: decomposerResult.plan.agents.length,
          swarmId: decomposerResult.plan.swarmId,
          decomposerModel: decomposerResult.decomposerModel,
          decomposerTokens: decomposerResult.tokensUsed,
          complexityClass: planResult.complexity,
          swarmEligibilityScore: planResult.swarmEligibilityScore,
          swarmComplexityZone: planResult.swarmComplexityZone,
          activeSkillDomains: activeSkillDomains.join(','),
        },
      });

      const swarmInput: SwarmOrchestratorInput = {
        plan: decomposerResult.plan,
        correlationId,
        userId: input.state.userId,
        conversationReference: input.conversationReference,
        userMessage: userMessageForLlm,
      };

      // Send immediate acknowledgment so the user knows a swarm is running (#634)
      const ackSpanStart = context.df.currentUtcDateTime.getTime();
      const PERSONA_EMOJI: Record<string, string> = { Helkin: '🤖', Benjamin: '🔍', Harper: '🧪', Lucas: '📊' };
      const agentNames = decomposerResult.plan.agents.map((a: { name: string }) => a.name);
      const agentTags = agentNames.map(n => `${PERSONA_EMOJI[n] ?? '🔹'} ${n}`).join(' • ');
      const ackMessage = `🧠 Swarm engaged → ${PERSONA_EMOJI['Helkin']} Helkin • ${agentTags}`;
      const ackInput: SendReplyInput = {
        userId: input.state.userId,
        message: ackMessage,
        correlationId,
        conversationReference: input.conversationReference,
        skipOutboundClaim: true,
      };
      yield context.df.callActivity('sendReplyActivity', ackInput);
      spans.push({ label: 'swarm-ack', durationMs: context.df.currentUtcDateTime.getTime() - ackSpanStart });

      // Outer timer must exceed inner worker+leader timeouts. Workers run parallel (60s max),
      // leader runs after (60s max), plus entity overhead (~10s). Total inner ≤ 130s.
      const swarmOuterTimeoutMs = Math.max(decomposerResult.plan.timeoutMs * 3, 180_000);
      const swarmTimer = context.df.createTimer(
        new Date(context.df.currentUtcDateTime.getTime() + swarmOuterTimeoutMs),
      );
      const swarmTask = context.df.callSubOrchestrator('swarmOrchestrator', swarmInput);
      const swarmWinner: df.Task = yield context.df.Task.any([swarmTask, swarmTimer]);

      let swarmResponse: string;
      let swarmTokens = decomposerResult.tokensUsed;
      let swarmModel = decomposerResult.decomposerModel;
      let swarmResultData: SwarmOrchestratorResult | undefined;

      if (swarmWinner === swarmTimer) {
        swarmResponse = '⚡ The multi-agent analysis timed out. Please try a simpler query or try again.';
      } else {
        swarmTimer.cancel();
        try {
          const swarmResult = swarmTask.result as SwarmOrchestratorResult;
          swarmResultData = swarmResult;
          // Guard against empty synthesis (e.g. leader LLM threw after workers succeeded)
          swarmResponse = swarmResult.response || '⚡ The swarm analysis completed but the final synthesis could not be produced. The team\'s research has been captured in the Swarm Activity tab.';
          swarmTokens += swarmResult.totalTokensUsed;
          swarmModel = swarmResult.leaderResult.model;

          yield* emitOrchestratorTelemetry(context, {
            name: 'SwarmExecutionCompleted',
            correlationId,
            userId: input.state.userId,
            properties: {
              swarmId: swarmResult.swarmId,
              success: swarmResult.success,
              totalTokens: swarmResult.totalTokensUsed,
              agentCount: swarmResult.agentResults.length,
              chatroomMessages: swarmResult.chatroomTranscript.length,
              leaderAgentsHeardFrom: swarmResult.leaderResult.agentsHeardFrom.join(', '),
              decomposerTokens: decomposerResult.tokensUsed,
              workerTokens: swarmResult.swarmCost?.workerTokens ?? 0,
              leaderTokens: swarmResult.swarmCost?.leaderTokens ?? 0,
              agentCostBreakdown: swarmResult.swarmCost?.agentBreakdown
                ?.map(a => `${a.agent}:${a.tokens}`)
                .join(', ') ?? '',
              agentToolsUsed: swarmResult.agentResults
                .map(r => `${r.agentName}:[${r.toolsUsed.join(',')}]`)
                .join('; '),
              agentDurations: swarmResult.agentResults
                .map(r => `${r.agentName}:${r.durationMs}ms`)
                .join(', '),
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          swarmResponse = '⚡ The multi-agent analysis failed before the final synthesis completed. The failure has been captured for audit in the Swarm Activity tab.';
          swarmModel = 'swarm-error';

          yield* emitOrchestratorTelemetry(context, {
            name: 'SwarmExecutionCompleted',
            correlationId,
            userId: input.state.userId,
            properties: {
              swarmId: decomposerResult.plan!.swarmId,
              error: message.slice(0, 240),
              decomposerTokens: decomposerResult.tokensUsed,
            },
          });
        }
      }

      // Append telemetry footer to swarm response
      const swarmTurnEndTime = context.df.currentUtcDateTime.getTime();
      const swarmTelemetryMode = 'verbose' as const;
      const swarmTimedOut = swarmWinner === swarmTimer;

      // Persist swarm execution data for the Swarm Activity viewer (#635).
      // Always persist — both successful and timed-out swarms should appear in the
      // Control Center so operators can see what happened even when things fail.
      {
        const persistInput: PersistSwarmResultInput = {
          userId: input.state.userId,
          correlationId,
          swarmId: decomposerResult.plan!.swarmId,
          userQuery: input.userMessage,
          decomposerTokens: decomposerResult.tokensUsed,
          decomposerModel: decomposerResult.decomposerModel,
          executionDurationMs: context.df.currentUtcDateTime.getTime() - turnStartTime,
          result: swarmResultData ?? {
            response: swarmTimedOut ? swarmResponse : '',
            success: false,
            totalTokensUsed: swarmTokens,
            agentResults: [],
            leaderResult: {
              synthesis: swarmResponse,
              success: false,
              tokensUsed: 0,
              roundsUsed: 0,
              agentsHeardFrom: [],
              model: swarmModel,
              error: swarmTimedOut ? 'swarm timed out' : 'orchestrator error',
            },
            chatroomTranscript: [],
            swarmId: decomposerResult.plan!.swarmId,
            swarmCost: undefined,
          },
        };
        yield context.df.callActivity('persistSwarmResultActivity', persistInput);
      }
      swarmResponse += formatTelemetryFooter(swarmTelemetryMode, {
        correlationId,
        timestampIso: new Date(swarmTurnEndTime).toISOString(),
        totalMs: swarmTurnEndTime - turnStartTime,
        model: `swarm:${swarmModel}`,
        promptTokens: 0,
        completionTokens: swarmTokens,
        spans,
        toolCalls: swarmResultData ? swarmResultData.agentResults.map((a) => `${a.agentName}:${a.toolCallsMade}t${a.success ? '✓' : '✗'}`) : [],
        safetyPassed: true,
        planComplexity: planResult.complexity,
        subAgentCount: swarmResultData ? swarmResultData.agentResults.length : 0,
        decomposerTokens: decomposerResult.tokensUsed,
        leaderTokens: swarmResultData?.leaderResult.tokensUsed,
        swarmAgentBreakdown: swarmResultData?.agentResults.map((a) => ({
          agent: a.agentName,
          tokens: a.tokensUsed,
          durationMs: a.durationMs,
          toolCalls: a.toolCallsMade,
          success: a.success,
          tokenBudget: a.tokenBudget,
          tokenBudgetExceeded: a.tokenBudgetExceeded,
        })),
      });

      // Deliver the swarm result
      const swarmReplyInput: SendReplyInput = {
        userId: input.state.userId,
        message: swarmResponse,
        correlationId,
        conversationReference: input.conversationReference,
      };
      const replyResult: SendReplyResult = yield context.df.callActivity('sendReplyActivity', swarmReplyInput);

      return {
        response: swarmResponse,
        cleanResponse: swarmResponse,
        tokensUsed: swarmTokens,
        promptTokens: 0,
        model: `swarm:${swarmModel}`,
        toolCalls: [],
        toolResults: null,
        replySent: replyResult.success,
        safetyPassed: true,
        pendingClarification: pendingClarificationUpdate,
      } satisfies SessionResult;
    }
    // If decomposer returned null (fallback), continue with normal sequential path
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
  const deterministicInitialToolCall = synthesizeRuntimeAssetInlineEmailToolCall(
    effectiveTaskMessage,
    input.runtimeAssets,
  )
    ?? synthesizeExactToolCall(effectiveTaskMessage, allToolSchemas)
    ?? synthesizeDeterministicReadOnlyInitialToolCall(effectiveTaskMessage, allToolSchemas);
  if (deterministicInitialToolCall) {
    yield* emitOrchestratorTelemetry(context, {
      name: 'PolicyOverrideApplied',
      correlationId,
      userId: input.state.userId,
      properties: {
        authority: 'discovery-deterministic-initial-tool-call',
        toolName: deterministicInitialToolCall.name,
        source: 'sessionOrchestrator',
      },
    });
  }
  const initialToolSchemas = deterministicInitialToolCall
    ? getDiscoveryFirstToolSchemas()
    : deriveContextAwareInitialToolSchemas(effectiveTaskMessage, allToolSchemas);
  const forcedInitialToolChoice = getForcedInitialToolChoice(effectiveTaskMessage, initialToolSchemas) ?? 'auto';
  if (forcedInitialToolChoice !== 'auto') {
    yield* emitOrchestratorTelemetry(context, {
      name: 'PolicyOverrideApplied',
      correlationId,
      userId: input.state.userId,
      properties: {
        authority: 'discovery-forced-initial-tool-choice',
        toolName: forcedInitialToolChoice.function.name,
        source: 'sessionOrchestrator',
      },
    });
  }
  const llmInput: LlmActivityInput = {
    ...promptWithPlan,
    correlationId,
    userId: input.state.userId,
    conversationId: turnConversationId,
    modelOverride: resolvedModelOverride,
    imageUrls: input.imageUrls,
    modelProfileTelemetry: initialToolSurface.profileModel
      ? {
          phase: 'initial',
          model: initialToolSurface.profileModel ?? initialToolSurfaceModelId,
          transformed: initialToolSurface.wasTransformed,
          toolCountBefore: toolRegistry.toFunctionSchemas().length,
          toolCountAfter: allToolSchemas.length,
          excludedTools: initialToolSurface.excluded.join(','),
        }
      : undefined,
    tools: initialToolSchemas,
    toolChoice: forcedInitialToolChoice,
  };

  const llmResult: LlmResult = deterministicInitialToolCall
    ? {
        content: '',
        model: 'deterministic-exact-tool',
        tokensUsed: 0,
        promptTokens: 0,
        toolCalls: [{
          id: crypto.randomUUID(),
          name: deterministicInitialToolCall.name,
          arguments: JSON.stringify(deterministicInitialToolCall.arguments),
        }],
        finishReason: 'tool_calls',
        operationalNotices: [],
        failoverSteps: [],
      }
    : yield context.df.callActivity('llmActivity', llmInput);
  spans.push({ label: 'llm', durationMs: context.df.currentUtcDateTime.getTime() - spanStart });

  if (llmResult.replyAlreadyDelivered) {
    yield* emitOrchestratorTelemetry(context, {
      name: 'PolicyOverrideApplied',
      correlationId,
      userId: input.state.userId,
      properties: {
        authority: 'post-reply-activity-replay-suppression',
        source: 'llmActivity',
      },
    });

    return {
      response: '(duplicate replay suppressed after visible reply delivery)',
      cleanResponse: '(duplicate replay suppressed after visible reply delivery)',
      tokensUsed: 0,
      promptTokens: 0,
      model: 'duplicate-replay-suppressed',
      toolCalls: [],
      toolResults: null,
      replySent: true,
      safetyPassed: true,
      duplicateReplaySuppressed: true,
    } satisfies SessionResult;
  }

  if (llmResult.shouldPageOut) {
    yield context.df.callActivity('saveChronoPausedTaskActivity', {
      userId: input.state.userId,
      interruptedInstanceId: context.df.instanceId,
      interruptedCorrelationId: correlationId,
      interruptedSource: 'mid-turn-llm-impairment',
      pausedByCorrelationId: correlationId,
      pausedByMessage: `Mid-turn impairment page-out while working on: ${effectiveTaskMessage}`,
    });
  }

  // Cumulative token tracking across all LLM calls in this session (#253)
  let cumulativeTokensUsed = llmResult.tokensUsed + planResult.planTokensUsed;
  let cumulativePromptTokens = llmResult.promptTokens;
  let cumulativeProviderCost = (llmResult.providerCost ?? 0) + (planResult.planProviderCost ?? 0);
  let cumulativeProviderCostUnit: 'credits' | undefined = llmResult.providerCostUnit ?? planResult.planProviderCostUnit;
  const cumulativeProviderCostDetails: Record<string, number> = { ...(planResult.planProviderCostDetails ?? {}) };
  for (const [key, value] of Object.entries(llmResult.providerCostDetails ?? {})) {
    cumulativeProviderCostDetails[key] = (cumulativeProviderCostDetails[key] ?? 0) + value;
  }
  let telemetryModel = llmResult.model;
  const telemetryModelSequence: string[] = [llmResult.model];
  const rememberTelemetryModel = (model: string): void => {
    telemetryModel = model;
    if (telemetryModelSequence[telemetryModelSequence.length - 1] !== model) {
      telemetryModelSequence.push(model);
    }
  };
  const operationalNotices = new Set<string>();
  rememberOperationalEvidence(operationalNotices, llmResult);

  const accumulateProviderCost = (
    amount: number | undefined,
    unit: 'credits' | undefined,
    details: Record<string, number> | undefined,
  ): void => {
    if (amount !== undefined) {
      cumulativeProviderCost += amount;
      cumulativeProviderCostUnit = unit ?? cumulativeProviderCostUnit ?? 'credits';
    }

    if (details) {
      for (const [key, value] of Object.entries(details)) {
        cumulativeProviderCostDetails[key] = (cumulativeProviderCostDetails[key] ?? 0) + value;
      }
    }
  };

  // Counters for telemetry footer (#321)
  let subAgentSpawnCount = 0;
  let scopedTokenMintCount = 0;
  let cumulativeWebSearchRequests = llmResult.webSearchRequests ?? 0;

  // 3. If LLM returned tool calls, run the safety pipeline
  let toolResults: ToolDispatchResult | null = null;
  let safetyPassed = true;
  let responseContent = llmResult.content;

  if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
    let completedPlanStepOrders: number[] = [];
    const successfulMutatingFingerprints = new Set<string>();
    const successfulReplayableReadOnlyResults = new Map<string, ToolDispatchResult['results'][number]>();
    const cumulativeToolCallsByName = new Map<string, number>();

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
    const toolCallsForDispatch = sortToolCallsByPlan(
      llmResult.toolCalls.slice(0, budget),
      planResult.steps,
      completedPlanStepOrders,
    );

    const initialPlanBatch = selectReadyToolCallsByPlan(
      toolCallsForDispatch,
      planResult.steps,
      completedPlanStepOrders,
    );
    const gatedToolCallsForDispatch = initialPlanBatch.selectedCalls.length > 0
      ? initialPlanBatch.selectedCalls
      : toolCallsForDispatch;

    const initialSeenToolFingerprints = new Set<string>();
    const initialToolCallCountByName = new Map<string, number>();
    const filteredInitialToolCalls = gatedToolCallsForDispatch.filter((call) => {
      const fingerprint = buildToolCallFingerprint(call.name, call.arguments);
      if (initialSeenToolFingerprints.has(fingerprint)) {
        return false;
      }

      // Per-tool cap: apply same limits in the initial batch
      const initialCount = initialToolCallCountByName.get(call.name) ?? 0;
      const initialCap = PER_TOOL_TURN_CAPS[call.name] ?? DEFAULT_PER_TOOL_TURN_CAP;
      if (initialCount >= initialCap) {
        return false;
      }

      const tool = toolRegistry.get(call.name);
      if (isMutatingTool(tool) && successfulMutatingFingerprints.has(fingerprint)) {
        return false;
      }

      initialSeenToolFingerprints.add(fingerprint);
      initialToolCallCountByName.set(call.name, initialCount + 1);
      return true;
    });

    // Determine aggregate risk from the tool registry
    const isLowRiskOnly = filteredInitialToolCalls.every((tc: { name: string }) => {
      const def = toolRegistry.get(tc.name);
      return def?.risk === 'low';
    });

    // Any tool with declarative requiresConfirmation must trigger the pipeline regardless of risk (#247)
    const anyDeclarativeConfirmation = filteredInitialToolCalls.some((tc: { name: string }) =>
      toolRegistry.get(tc.name)?.requiresConfirmation === true,
    );

    // Per-tool opt-out: if ALL tools in the batch have requiresConfirmation:false,
    // skip the confirmation card even for medium/high risk (#302).
    const allToolsSkipConfirmation = filteredInitialToolCalls.every((tc: { name: string }) =>
      toolRegistry.get(tc.name)?.requiresConfirmation === false,
    );

    // Capture verified-set data from the safety pipeline for executor binding (#266)
    let verifiedSetHash: string | undefined;
    let verifiedAt: string | undefined;

    if (!isLowRiskOnly || anyDeclarativeConfirmation) {
      // Determine the highest risk level among requested tools
      const highestRisk = filteredInitialToolCalls.some((tc: { name: string }) =>
        toolRegistry.get(tc.name)?.risk === 'high') ? 'high' as const : 'medium' as const;

      // Run pre-execution verification pipeline (steps 1-4: schema, data min, spot check, shields)
      const verification = yield context.df.callActivity('verificationPipelineActivity', {
        correlationId,
        sessionId: input.state.userId,
        userId: input.state.userId,
          toolName: filteredInitialToolCalls.map((tc: { name: string }) => tc.name).join(', '),
        risk: highestRisk,
          rawOutput: filteredInitialToolCalls,
        originalQuery: effectiveTaskMessage,
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
          toolName: filteredInitialToolCalls.map((tc: { name: string }) => tc.name).join(', '),
          risk: highestRisk,
          description: `Execute ${filteredInitialToolCalls.length} tool(s): ${filteredInitialToolCalls.map((tc: { name: string }) => tc.name).join(', ')}`,
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
            const parsedResponse = ConfirmationResponseSchema.safeParse(confirmation.result);
            if (!parsedResponse.success || !isMatchingConfirmationResponse(parsedResponse.data, {
              correlationId,
              toolName: cardInput.toolName,
              userId: input.state.userId,
              sessionInstanceId: context.df.instanceId,
            })) {
              responseContent = '❌ Confirmation response did not match the active approval request. Action cancelled.';
              safetyPassed = false;
            } else if (parsedResponse.data.action !== 'approved') {
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
      // The conscious thread may delegate narrow instrumental/autonomic work here,
      // but those helpers must always return control/results to this single thread.
      // Split tool calls: sub-agent isolated vs direct dispatch (#47)
      const toolDispatchStart = context.df.currentUtcDateTime.getTime();
      const subAgentCalls: typeof toolCallsForDispatch = [];
      const directCalls: typeof toolCallsForDispatch = [];

      for (const tc of filteredInitialToolCalls) {
        const def = toolRegistry.get(tc.name);
        const executionHint = resolveExecutionHint(tc.name, def, planResult.steps, completedPlanStepOrders);
        if (executionHint.useSubAgent) {
          subAgentCalls.push(tc);
        } else {
          directCalls.push(tc);
        }
      }

      // Run sub-agent isolated tool calls (fresh LLM session, secondary model)
      const subAgentResults: ToolDispatchResult['results'] = [];
      for (const tc of subAgentCalls) {
        const def = toolRegistry.get(tc.name);
        const executionHint = resolveExecutionHint(tc.name, def, planResult.steps, completedPlanStepOrders);
        const subInput: SubAgentInput = {
          toolName: tc.name,
          toolDescription: def?.description ?? tc.name,
          toolInputSchema: def?.inputSchema,
          arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
          userContext: effectiveTaskMessage,
          correlationId,
          sessionId: input.state.userId,
          userId: input.state.userId,
          round: 'initial',
          preferredModel: executionHint.preferredModel,
          planStepOrder: executionHint.stepOrder,
        };
        const subResult: SubAgentResult = yield* withSubAgentTimeout(context, subInput);
        subAgentSpawnCount++;
        subAgentResults.push({
          toolCallId: tc.id,
          toolName: tc.name,
          success: subResult.success,
          result: subResult.output,
          error: subResult.error,
          requiresExecutor: false,
          scopedTokenMinted: subResult.scopedTokenMinted,
          scopedTokenMethod: subResult.scopedTokenMethod,
          scopedTokenScope: subResult.scopedTokenScope,
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
          scopedTokenMinted: execResult.scopedTokenMinted,
          scopedTokenMethod: execResult.scopedTokenMethod,
          scopedTokenScope: execResult.scopedTokenScope as 'read' | 'write' | 'delete' | 'admin' | undefined,
        };
      }

      toolResults = {
        results: mergedResults,
        totalCalls: mergedResults.length,
      };
      recordSuccessfulMutatingFingerprints(
        filteredInitialToolCalls,
        mergedResults,
        (toolName) => toolRegistry.get(toolName),
        successfulMutatingFingerprints,
      );
      recordSuccessfulReplayableReadOnlyResults(
        filteredInitialToolCalls,
        mergedResults,
        (toolName) => toolRegistry.get(toolName),
        successfulReplayableReadOnlyResults,
      );
      for (const call of filteredInitialToolCalls) {
        cumulativeToolCallsByName.set(call.name, (cumulativeToolCallsByName.get(call.name) ?? 0) + 1);
      }
      completedPlanStepOrders = collectCompletedPlanStepOrders(
        mergedResults.map((result) => ({ toolName: result.toolName, success: result.success })),
        planResult.steps,
        completedPlanStepOrders,
      );
      scopedTokenMintCount += mergedResults.filter((result) => result.scopedTokenMinted).length;
      spans.push({ label: 'tools', durationMs: context.df.currentUtcDateTime.getTime() - toolDispatchStart });

      if (isExplicitReadOnlyDiscoveryRequest) {
        responseContent = buildReadOnlyDiscoveryResponse(toolResults.results, effectiveTaskMessage);
      } else {
      const deterministicExactToolResponse = buildDeterministicExactToolResponse(
        effectiveTaskMessage,
        toolResults.results,
      );
      if (deterministicExactToolResponse) {
        responseContent = deterministicExactToolResponse;
      } else {

      // 3b. Multi-round tool dispatch loop (#253)
      // The LLM can request additional tool calls after seeing results,
      // enabling chained reasoning (e.g. "find my latest email, then forward it").
      // Max rounds from toolBudget or default 5, capped at 10.
      const maxToolRounds = Math.min(input.toolBudget ?? 5, 10);
      const selectiveFollowUpSchemas = deriveSelectiveFollowUpToolSchemas(toolResults?.results ?? []);
      const discoveryFollowUpModelOverride = getDiscoveryFollowUpModelOverride(toolResults?.results ?? []);
      const effectiveFollowUpModelOverride = resolvedModelOverride ?? discoveryFollowUpModelOverride;
      const followUpToolSurfaceModelId = resolveToolSurfaceModelId(effectiveFollowUpModelOverride);
      const followUpToolSurface = applyModelProfileToFunctionSchemas(
        selectiveFollowUpSchemas ?? allToolSchemas,
        followUpToolSurfaceModelId,
      );
      const followUpToolSchemas = followUpToolSurface.tools;
      const followUpModelProfileTelemetry = followUpToolSurface.profileModel
        ? {
            phase: 'followup' as const,
            model: followUpToolSurface.profileModel ?? followUpToolSurfaceModelId,
            transformed: followUpToolSurface.wasTransformed,
            toolCountBefore: (selectiveFollowUpSchemas ?? allToolSchemas).length,
            toolCountAfter: followUpToolSchemas.length,
            excludedTools: followUpToolSurface.excluded.join(','),
          }
        : undefined;
      if (followUpToolSurface.wasTransformed) {
        yield* emitOrchestratorTelemetry(context, {
          name: 'ModelProfileApplied',
          correlationId,
          userId: input.state.userId,
          properties: {
            phase: 'followup',
            model: followUpToolSurface.profileModel ?? followUpToolSurfaceModelId,
            toolCountBefore: (selectiveFollowUpSchemas ?? allToolSchemas).length,
            toolCountAfter: followUpToolSchemas.length,
            excludedTools: followUpToolSurface.excluded.join(','),
          },
        });
      }
      // Suppress deterministic follow-up synthesis if the same tool already
      // succeeded in the initial dispatch. We have the data; re-calling it
      // wastes tokens and latency without providing new information (#622).
      const alreadySucceededToolNames = new Set(
        (toolResults?.results ?? [])
          .filter((r) => r.success)
          .map((r) => r.toolName),
      );
      const rawDeterministicFollowUp = synthesizeDeterministicFollowUpToolCall(
        effectiveTaskMessage,
        followUpToolSchemas,
      );
      const deterministicFollowUpToolCall = synthesizeExactToolCall(
        effectiveTaskMessage,
        followUpToolSchemas,
      ) ?? (rawDeterministicFollowUp && !alreadySucceededToolNames.has(rawDeterministicFollowUp.name)
        ? rawDeterministicFollowUp
        : null)
        ?? deriveLocatorUrlFetchCall(toolResults.results ?? [], followUpToolSchemas)
        ?? deriveWebInteractDealerLocatorCall(effectiveTaskMessage, toolResults.results ?? [], followUpToolSchemas);
      if (deterministicFollowUpToolCall) {
        yield* emitOrchestratorTelemetry(context, {
          name: 'PolicyOverrideApplied',
          correlationId,
          userId: input.state.userId,
          properties: {
            authority: 'discovery-deterministic-followup-tool-call',
            toolName: deterministicFollowUpToolCall.name,
            source: 'sessionOrchestrator',
          },
        });
      }
      const rawForcedFollowUpToolChoice = getForcedDiscoveryFollowUpToolChoice(
        effectiveTaskMessage,
        selectiveFollowUpSchemas,
      );
      // Same guard: don't force a follow-up tool that already succeeded (#622).
      const forcedFollowUpToolChoice = (
        rawForcedFollowUpToolChoice &&
        !alreadySucceededToolNames.has(rawForcedFollowUpToolChoice.function.name)
      ) ? rawForcedFollowUpToolChoice : undefined;
      if (selectiveFollowUpSchemas) {
        yield* emitOrchestratorTelemetry(context, {
          name: 'DiscoveryToolSubsetSelected',
          correlationId,
          userId: input.state.userId,
          properties: {
            toolCount: selectiveFollowUpSchemas.length,
            selectedTools: selectiveFollowUpSchemas.map((tool) => tool.function.name).join(','),
          },
        });
      }
      if (forcedFollowUpToolChoice) {
        yield* emitOrchestratorTelemetry(context, {
          name: 'PolicyOverrideApplied',
          correlationId,
          userId: input.state.userId,
          properties: {
            authority: 'discovery-forced-followup-tool-choice',
            toolName: forcedFollowUpToolChoice.function.name,
            source: 'sessionOrchestrator',
          },
        });
      }
      if (discoveryFollowUpModelOverride && !input.modelOverride) {
        yield* emitOrchestratorTelemetry(context, {
          name: 'PolicyOverrideApplied',
          correlationId,
          userId: input.state.userId,
          properties: {
            authority: 'discovery-model-affinity',
            source: discoveryFollowUpModelOverride,
          },
        });
      }
      const initialResultCount = mergedResults.length;

      const followUpInput: LlmFollowUpInput = {
        // Preserve plan-injected system guidance across follow-up rounds (#340 regression).
        // Using the pre-plan prompt here causes compound requests to forget remaining
        // steps after the first tool call (e.g. search -> read -> reply chains).
        originalMessages: promptWithPlan.messages,
        assistantToolCallMessage: {
          content: llmResult.content,
            toolCalls: filteredInitialToolCalls,
        },
        toolResults: toolResults?.results ?? [],
        correlationId,
        modelOverride: effectiveFollowUpModelOverride,
        enableRetry: true,
        modelProfileTelemetry: followUpModelProfileTelemetry,
        tools: selectiveFollowUpSchemas ?? allToolSchemas,
        toolChoice: forcedFollowUpToolChoice,
      };
      spanStart = context.df.currentUtcDateTime.getTime();
      let followUp: LlmResult = deterministicFollowUpToolCall
        ? {
            content: '',
            model: llmResult.model,
            tokensUsed: 0,
            promptTokens: 0,
            toolCalls: [{
              id: crypto.randomUUID(),
              name: deterministicFollowUpToolCall.name,
              arguments: JSON.stringify(deterministicFollowUpToolCall.arguments),
            }],
            finishReason: 'tool_calls',
            operationalNotices: [],
            failoverSteps: [],
          }
        : yield* withLlmFollowUpTimeout(context, followUpInput);
      rememberTelemetryModel(followUp.model);
      cumulativeTokensUsed += followUp.tokensUsed;
      cumulativePromptTokens += followUp.promptTokens;
      accumulateProviderCost(followUp.providerCost, followUp.providerCostUnit, followUp.providerCostDetails);
      cumulativeWebSearchRequests += followUp.webSearchRequests ?? 0;
      rememberOperationalEvidence(operationalNotices, followUp);

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
            originalMessages: promptWithPlan.messages,
            assistantToolCallMessage: {
              content: llmResult.content,
              toolCalls: filteredInitialToolCalls,
            },
            toolResults: toolResults?.results.slice(0, initialResultCount) ?? [],
            correlationId,
            modelOverride: effectiveFollowUpModelOverride,
            enableRetry: false,
            modelProfileTelemetry: followUpModelProfileTelemetry,
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
          followUp = yield* withLlmFollowUpTimeout(context, truncRetryInput);
          rememberTelemetryModel(followUp.model);
          cumulativeTokensUsed += followUp.tokensUsed;
          cumulativePromptTokens += followUp.promptTokens;
          accumulateProviderCost(followUp.providerCost, followUp.providerCostUnit, followUp.providerCostDetails);
          cumulativeWebSearchRequests += followUp.webSearchRequests ?? 0;
          rememberOperationalEvidence(operationalNotices, followUp);
          break; // Truncation retry is terminal — don't loop further
        }

        console.log(
          `[sessionOrchestrator] Multi-round ${toolRound}/${maxToolRounds}: ` +
          `dispatching ${followUp.toolCalls.length} tool call(s) (#253)`,
        );

        // Multi-round policy: allow low/medium tools freely, and allow only the
        // subset of high-risk tools that explicitly skip confirmation and do not
        // require the executor path in the current environment.
        const sortedRoundCalls = sortToolCallsByPlan(
          followUp.toolCalls,
          planResult.steps,
          completedPlanStepOrders,
        );
        const roundPlanBatch = selectReadyToolCallsByPlan(
          sortedRoundCalls,
          planResult.steps,
          completedPlanStepOrders,
        );
        const roundCallsForDispatch = (roundPlanBatch.selectedCalls.length > 0
          ? roundPlanBatch.selectedCalls
          : sortedRoundCalls).filter(
          (tc: { name: string }) => {
            const def = toolRegistry.get(tc.name);
            return canExecuteInMultiRound(def);
          },
        );

        const suppressedRoundResults = roundCallsForDispatch
          .filter((call) => {
            const tool = toolRegistry.get(call.name);
            if (!isMutatingTool(tool)) {
              return false;
            }

            const fingerprint = buildToolCallFingerprint(call.name, call.arguments);
            return successfulMutatingFingerprints.has(fingerprint);
          })
          .map((call) => buildDuplicateSuppressedToolResult(call));

        const replayedRoundResults = roundCallsForDispatch.flatMap((call) => {
          const tool = toolRegistry.get(call.name);
          if (!isReplayableReadOnlyTool(tool)) {
            return [];
          }

          const fingerprint = buildToolCallFingerprint(call.name, call.arguments);
          const priorResult = successfulReplayableReadOnlyResults.get(fingerprint);
          return priorResult ? [buildDuplicateReplayedToolResult(call, priorResult)] : [];
        });

        const capExceededRoundResults = roundCallsForDispatch
          .filter((call) => {
            const count = cumulativeToolCallsByName.get(call.name) ?? 0;
            const cap = PER_TOOL_TURN_CAPS[call.name] ?? DEFAULT_PER_TOOL_TURN_CAP;
            return count >= cap;
          })
          .map((call) => buildCapExceededToolResult(call, PER_TOOL_CAP_EXCEEDED_MESSAGES[call.name]));

        const roundToolCallCountByName = new Map<string, number>();
        const filteredRoundCallsForDispatch = roundCallsForDispatch.filter((call) => {
          const tool = toolRegistry.get(call.name);
          const fingerprint = buildToolCallFingerprint(call.name, call.arguments);

          // Per-tool-per-turn cap: cumulative + within-this-round to prevent batch bypass
          const cumulativeCount = cumulativeToolCallsByName.get(call.name) ?? 0;
          const roundCount = roundToolCallCountByName.get(call.name) ?? 0;
          const toolCap = PER_TOOL_TURN_CAPS[call.name] ?? DEFAULT_PER_TOOL_TURN_CAP;
          if (cumulativeCount + roundCount >= toolCap) {
            return false;
          }

          if (isReplayableReadOnlyTool(tool) && successfulReplayableReadOnlyResults.has(fingerprint)) {
            return false;
          }

          if (!isMutatingTool(tool)) {
            roundToolCallCountByName.set(call.name, roundCount + 1);
            return true;
          }

          if (successfulMutatingFingerprints.has(fingerprint)) {
            return false;
          }
          roundToolCallCountByName.set(call.name, roundCount + 1);
          return true;
        });

        if (filteredRoundCallsForDispatch.length === 0) {
          const skippedRoundResults = [...suppressedRoundResults, ...replayedRoundResults, ...capExceededRoundResults];
          if (skippedRoundResults.length > 0) {
            additionalTurns.push({
              assistantContent: followUp.content,
              assistantToolCalls: roundCallsForDispatch,
              toolResults: skippedRoundResults,
            });
            toolResults.results.push(...skippedRoundResults);
            toolResults.totalCalls += skippedRoundResults.length;

            const forcedTextFollowUpInput: LlmFollowUpInput = {
              originalMessages: promptWithPlan.messages,
              assistantToolCallMessage: {
                content: llmResult.content,
                toolCalls: filteredInitialToolCalls,
              },
              toolResults: toolResults?.results.slice(0, initialResultCount) ?? [],
              correlationId,
              modelOverride: effectiveFollowUpModelOverride,
              enableRetry: false,
              modelProfileTelemetry: followUpModelProfileTelemetry,
              additionalTurns,
            };
            followUp = yield* withLlmFollowUpTimeout(context, forcedTextFollowUpInput);
            rememberTelemetryModel(followUp.model);
            cumulativeTokensUsed += followUp.tokensUsed;
            cumulativePromptTokens += followUp.promptTokens;
            accumulateProviderCost(followUp.providerCost, followUp.providerCostUnit, followUp.providerCostDetails);
            cumulativeWebSearchRequests += followUp.webSearchRequests ?? 0;
            rememberOperationalEvidence(operationalNotices, followUp);
          }
          break;
        }

        const roundToolDefs = filteredRoundCallsForDispatch
          .map((tc: { name: string }) => toolRegistry.get(tc.name))
          .filter((def): def is NonNullable<typeof def> => !!def);
        const highestRoundRisk = getHighestMultiRoundRisk(roundToolDefs);

        // Verification for medium/high-risk tools in multi-round.
        if (highestRoundRisk !== 'low') {
          const roundVerification = yield context.df.callActivity('verificationPipelineActivity', {
            correlationId,
            sessionId: input.state.userId,
            userId: input.state.userId,
            toolName: filteredRoundCallsForDispatch.map((tc: { name: string }) => tc.name).join(', '),
            risk: highestRoundRisk,
            rawOutput: filteredRoundCallsForDispatch,
            originalQuery: effectiveTaskMessage,
            // Multi-round remains non-interactive; only batches whose tools all
            // explicitly skip confirmation may proceed here.
            skipConfirmation: shouldSkipConfirmationForMultiRound(roundToolDefs),
          });
          if (!roundVerification.passed && !roundVerification.requiresConfirmation) {
            console.log(`[sessionOrchestrator] Multi-round ${toolRound}: verification blocked ${highestRoundRisk}-risk tools`);
            followUp = {
              ...followUp,
              content: `Safety pipeline blocked this action: ${roundVerification.error}`,
              toolCalls: [],
              finishReason: 'stop',
            };
            break;
          }

          if (roundVerification.requiresConfirmation) {
            const cardInput: SendConfirmationCardInput = {
              userId: input.state.userId,
              toolName: filteredRoundCallsForDispatch.map((tc: { name: string }) => tc.name).join(', '),
              risk: highestRoundRisk,
              description: `Execute ${filteredRoundCallsForDispatch.length} tool(s): ${filteredRoundCallsForDispatch.map((tc: { name: string }) => tc.name).join(', ')}`,
              correlationId,
              sessionInstanceId: context.df.instanceId,
            };
            const cardResult: SendConfirmationCardResult = yield context.df.callActivity(
              'sendConfirmationCardActivity',
              cardInput,
            );

            if (!cardResult.sent) {
              followUp = {
                ...followUp,
                content: 'Safety: Unable to send confirmation card. Action blocked.',
                toolCalls: [],
                finishReason: 'stop',
              };
              break;
            }

            const timeoutMs = 5 * 60 * 1000;
            const deadline = new Date(context.df.currentUtcDateTime.getTime() + timeoutMs);
            const timer = context.df.createTimer(deadline);
            const confirmation = context.df.waitForExternalEvent('ConfirmationResponse');

            const winner = yield context.df.Task.any([confirmation, timer]);

            if (winner === timer) {
              followUp = {
                ...followUp,
                content: '⏰ Action timed out after 5 minutes. The tool call was cancelled for safety.',
                toolCalls: [],
                finishReason: 'stop',
              };
              break;
            }

            timer.cancel();
            const parsedResponse = ConfirmationResponseSchema.safeParse(confirmation.result);
            if (!parsedResponse.success || !isMatchingConfirmationResponse(parsedResponse.data, {
              correlationId,
              toolName: cardInput.toolName,
              userId: input.state.userId,
              sessionInstanceId: context.df.instanceId,
            })) {
              followUp = {
                ...followUp,
                content: '❌ Confirmation response did not match the active approval request. Action cancelled.',
                toolCalls: [],
                finishReason: 'stop',
              };
              break;
            }

            if (parsedResponse.data.action !== 'approved') {
              followUp = {
                ...followUp,
                content: '❌ Action cancelled by user.',
                toolCalls: [],
                finishReason: 'stop',
              };
              break;
            }
          }
        }

        // The conscious thread still owns the turn here; follow-up helpers remain
        // instrumental/autonomic and may never become independent conscious threads.
        // Split into sub-agent vs direct dispatch (same as initial dispatch) (#319)
        const roundSubAgentCalls: typeof roundCallsForDispatch = [];
        const roundDirectCalls: typeof roundCallsForDispatch = [];
        for (const tc of filteredRoundCallsForDispatch) {
          const def = toolRegistry.get(tc.name);
          const executionHint = resolveExecutionHint(tc.name, def, planResult.steps, completedPlanStepOrders);
          if (executionHint.useSubAgent) {
            roundSubAgentCalls.push(tc);
          } else {
            roundDirectCalls.push(tc);
          }
        }

        yield* emitOrchestratorTelemetry(context, {
          name: 'MultiRoundDispatch',
          correlationId,
          userId: input.state.userId,
          properties: {
            round: toolRound,
            toolCount: filteredRoundCallsForDispatch.length,
            subAgentCount: roundSubAgentCalls.length,
            directCount: roundDirectCalls.length,
            planComplexity: planResult.complexity,
          },
        });

        // Execute sub-agent calls (#319)
        const roundSubResults: ToolDispatchResult['results'] = [];
        for (const tc of roundSubAgentCalls) {
          const def = toolRegistry.get(tc.name);
          const executionHint = resolveExecutionHint(tc.name, def, planResult.steps, completedPlanStepOrders);
          const subInput: SubAgentInput = {
            toolName: tc.name,
            toolDescription: def?.description ?? tc.name,
            toolInputSchema: def?.inputSchema,
            arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
            userContext: effectiveTaskMessage,
            correlationId,
            sessionId: input.state.userId,
            userId: input.state.userId,
            round: 'followup',
            preferredModel: executionHint.preferredModel,
            planStepOrder: executionHint.stepOrder,
          };
          const subResult: SubAgentResult = yield* withSubAgentTimeout(context, subInput);
          subAgentSpawnCount++;
          roundSubResults.push({
            toolCallId: tc.id,
            toolName: tc.name,
            success: subResult.success,
            result: subResult.output,
            error: subResult.error,
            requiresExecutor: false,
            scopedTokenMinted: subResult.scopedTokenMinted,
            scopedTokenMethod: subResult.scopedTokenMethod,
            scopedTokenScope: subResult.scopedTokenScope,
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
            conversationId: turnConversationId,
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
        completedPlanStepOrders = collectCompletedPlanStepOrders(
          roundResults.results.map((result) => ({ toolName: result.toolName, success: result.success })),
          planResult.steps,
          completedPlanStepOrders,
        );

        // Accumulate this turn for conversation history
        additionalTurns.push({
          assistantContent: followUp.content,
          assistantToolCalls: filteredRoundCallsForDispatch,
          toolResults: [...suppressedRoundResults, ...capExceededRoundResults, ...roundResults.results],
        });

        // Accumulate into overall tool results for telemetry
        toolResults.results.push(...suppressedRoundResults);
        toolResults.totalCalls += suppressedRoundResults.length;
        toolResults.results.push(...capExceededRoundResults);
        toolResults.totalCalls += capExceededRoundResults.length;
        toolResults.results.push(...roundResults.results);
        toolResults.totalCalls += roundResults.results.length;
        scopedTokenMintCount += roundResults.results.filter((result) => result.scopedTokenMinted).length;
        recordSuccessfulMutatingFingerprints(
          filteredRoundCallsForDispatch,
          roundResults.results,
          (toolName) => toolRegistry.get(toolName),
          successfulMutatingFingerprints,
        );
        recordSuccessfulReplayableReadOnlyResults(
          filteredRoundCallsForDispatch,
          roundResults.results,
          (toolName) => toolRegistry.get(toolName),
          successfulReplayableReadOnlyResults,
        );
        for (const call of filteredRoundCallsForDispatch) {
          cumulativeToolCallsByName.set(call.name, (cumulativeToolCallsByName.get(call.name) ?? 0) + 1);
        }

        const shouldForceFinalTextResponse = highestRoundRisk === 'high'
          && roundResults.results.some((result) => result.success);

        // On the last allowed round, don't pass tools — force a text response
        const isLastRound = toolRound >= maxToolRounds;
        const allowMoreFollowUpTools = !isLastRound && !shouldForceFinalTextResponse;

        // Call follow-up again with full conversation history
        const roundFollowUpInput: LlmFollowUpInput = {
          originalMessages: promptWithPlan.messages,
          assistantToolCallMessage: {
            content: llmResult.content,
            toolCalls: filteredInitialToolCalls,
          },
          toolResults: toolResults?.results.slice(0, initialResultCount) ?? [],
          correlationId,
          modelOverride: effectiveFollowUpModelOverride,
          enableRetry: allowMoreFollowUpTools,
          modelProfileTelemetry: followUpModelProfileTelemetry,
          tools: allowMoreFollowUpTools ? (selectiveFollowUpSchemas ?? allToolSchemas) : undefined,
          toolChoice: allowMoreFollowUpTools ? forcedFollowUpToolChoice : undefined,
          additionalTurns,
        };
        followUp = yield* withLlmFollowUpTimeout(context, roundFollowUpInput);
        rememberTelemetryModel(followUp.model);
        cumulativeTokensUsed += followUp.tokensUsed;
        cumulativePromptTokens += followUp.promptTokens;
        accumulateProviderCost(followUp.providerCost, followUp.providerCostUnit, followUp.providerCostDetails);
        cumulativeWebSearchRequests += followUp.webSearchRequests ?? 0;
        rememberOperationalEvidence(operationalNotices, followUp);
      }

      responseContent = followUp.content;
      spans.push({ label: 'followup', durationMs: context.df.currentUtcDateTime.getTime() - spanStart });
      }
      }
    }
  }

  // 4. Guard against empty response — Teams rejects empty text
  if (!responseContent || responseContent.trim().length === 0) {
    responseContent = isDiscoveryOnlyDeadEnd(toolResults?.results)
      ? buildDiscoveryDeadEndResponse(effectiveTaskMessage)
      : 'I processed your request but have nothing to report back.';
  }

  // 5. Send reply to Teams (proactive)
  // For DevLoop sessions, wrap the response in protocol format (#147, #92)
  const cleanResponse = responseContent; // Preserve pre-decoration LLM output for recentHistory
  for (const notice of recoverOperationalNoticesFromTrace(correlationId)) {
    operationalNotices.add(notice);
  }
  const displayResponse = operationalNotices.size > 0
    ? `${Array.from(operationalNotices).join('\n')}\n\n${responseContent}`
    : responseContent;
  let replyMessage = displayResponse;

  const modelDisclosure = buildModelOverrideDisclosure(resolvedModelOverride, telemetryModel);
  if (modelDisclosure) {
    replyMessage = `${modelDisclosure}\n\n${replyMessage}`;
  }

  // 5a. Append debug telemetry footer (#174, #254, spec: 0n)
  // Always appended — even in 'off' mode, a correlation ID suffix is shown.
  {
    const telemetryMode = 'verbose' as const;
    const turnEndTime = context.df.currentUtcDateTime.getTime();
    const toolNames: string[] = toolResults?.results?.map(
      (r: { toolName: string }) => r.toolName,
    ) ?? [];

    const telemetryData: TurnTelemetryData = {
      correlationId,
      timestampIso: new Date(turnEndTime).toISOString(),
      totalMs: turnEndTime - turnStartTime,
      model: telemetryModel,
      modelSequence: telemetryModelSequence,
      promptTokens: cumulativePromptTokens,
      completionTokens: cumulativeTokensUsed - cumulativePromptTokens,
      providerCost: cumulativeProviderCostUnit ? cumulativeProviderCost : undefined,
      providerCostUnit: cumulativeProviderCostUnit,
      providerCostDetails: Object.keys(cumulativeProviderCostDetails).length > 0
        ? cumulativeProviderCostDetails
        : undefined,
      spans,
      toolCalls: toolNames,
      safetyPassed,
      planComplexity: planResult.complexity,
      subAgentCount: subAgentSpawnCount > 0 ? subAgentSpawnCount : undefined,
      scopedTokenMintCount: scopedTokenMintCount > 0 ? scopedTokenMintCount : undefined,
      webSearchRequests: cumulativeWebSearchRequests > 0 ? cumulativeWebSearchRequests : undefined,
    };
    replyMessage += formatTelemetryFooter(telemetryMode, telemetryData);
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
    conversationReference: input.conversationReference,
  };
  const replyResult: SendReplyResult = yield context.df.callActivity(
    'sendReplyActivity',
    replyInput,
  );

  return {
    response: displayResponse,
    cleanResponse,
    tokensUsed: cumulativeTokensUsed,
    promptTokens: cumulativePromptTokens,
    model: llmResult.model,
    toolCalls: llmResult.toolCalls,
    toolResults: summarizeToolResultsForSessionResult(toolResults),
    replySent: replyResult.success,
    safetyPassed,
    pendingClarification: pendingClarificationUpdate,
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
