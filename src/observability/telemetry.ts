// Structured telemetry — consistent event emission with correlation IDs.
// All key events flow through here to ensure uniform schema in App Insights.
// Spec ref: 13-Observability-Monitoring.md, issues #84, #85
//
// Uses OpenTelemetry trace API + span events to emit structured custom events.
// The @azure/monitor-opentelemetry exporter (initialized in functions/index.ts)
// automatically forwards these to App Insights.

import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { recordTracePhase, type TracePhaseType } from './sessionTracer.js';
import { APP_VERSION } from '../config/version.js';

const tracer = trace.getTracer('helkinswarm', APP_VERSION);

// ---------------------------------------------------------------------------
// Event names — consistent across the codebase
// ---------------------------------------------------------------------------

export type TelemetryEventName =
  | 'TurnStarted'
  | 'TurnCompleted'
  | 'PromptShieldResult'
  | 'ToolExecuted'
  | 'SubAgentToolExecuted'
  | 'ScopedTokenMinted'
  | 'VerificationPipelineResult'
  | 'HumanConfirmationRequested'
  | 'HumanConfirmationReceived'
  | 'DurableHookRegistered'
  | 'DurableHookTriggered'
  | 'SkillMemoryInjected'
  | 'HydraNetEmbedding'
  | 'ContinueAsNewTriggered'
  | 'EUResidencyViolation'
  | 'DevLoopSteerReceived'
  | 'DevLoopRelayPush'
  | 'DevLoopRelayPoll'
  | 'LlmCallStarted'
  | 'LlmCallCompleted'
  | 'LlmCallFailed'
  | 'LlmFallbackTriggered'
  | 'LlmFallbackChainCompleted'
  | 'GraphNotificationProcessed'
  | 'GraphSubscriptionRenewed'
  | 'PendingIntentCreated'
  | 'PendingIntentRecovered'
  | 'ChronoScheduledWakeRegistered'
  | 'ChronoScheduledWakeDeferred'
  | 'ChronoScheduledWakeTriggered'
  | 'PausedTaskPaged'
  | 'PausedTaskResumeInjected'
  | 'LivingSessionIngressWindowOpened'
  | 'LivingSessionNewMessageDrained'
  | 'LivingSessionHookDrained'
  | 'LimbicDecision'
  | 'BufferedIngressQueued'
  | 'BufferedIngressDequeued'
  | 'BufferedIngressFallbackReplayed'
  | 'ChronoBackplaneRead'
  | 'ChronoBackplaneWritten'
  | 'InterruptionBreadcrumbWritten'
  | 'InterruptionBreadcrumbRead'
  | 'SteeringInjectionApplied'
  | 'StaleAckRecovered'
  | 'StaleAckRecoveryMessageEdited'
  | 'StateLoaded'
  | 'StateSaved'
  | 'SkillLifecycleAction'
  | 'SkillCredentialRevoked'
  | 'MaintenanceSweepCompleted'
  | 'ExecutorVerifiedSetBinding'
  | 'StaleSessionCleanup'
  | 'BotMessageReceived'
  | 'PromptBuilt'
  | 'ReplySent'
  | 'OrchestratorPlanCreated'
  | 'PlanClassification'
  | 'PlanGenerated'
  | 'PlanParseError'
  | 'HandlerTokenSource'
  | 'OboSessionBootstrapped'
  | 'SubAgentSpawned'
  | 'MultiRoundDispatch'
  | 'DiscoveryQueryExecuted'
  | 'DiscoveryToolSubsetSelected'
  | 'DiscoveryRegistryFallbackUsed'
  | 'ModelProfileApplied'
  | 'McpRegistryCatalogRefreshed'
  | 'McpRegistrySearchExecuted'
  | 'PolicyOverrideApplied'
  | 'ClarificationRequested'
  | 'ClarificationRetryRequested'
  | 'ClarificationResumed'
  | 'ClarificationCancelled'
  | 'ClarificationExpired'
  | 'PostReplyBatchCompleted'
  | 'SwarmExecutionStarted'
  | 'SwarmExecutionCompleted'
  | 'SwarmDecomposerParseError'
  | 'SwarmDecomposerValidationError'
  | 'SwarmPlanGenerated'
  | 'SwarmDecomposerError'
  | 'SwarmDecomposerFallback'
  | 'SwarmDeterministicActivation'
  | 'SwarmActivationDecision'
  | 'SwarmStaleRunningReconciled'
  | 'OpenRouterRateLimitSnapshot'
  | 'OpenRouterUpstreamRetry'
  | 'OpenRouterConcurrencyGate'
  | 'SwarmWorkerStarted'
  | 'SwarmWorkerCompleted'
  | 'SwarmWorkerBudgetExceeded'
  | 'SwarmWorkerError'
  | 'SwarmWorkerWaitRequested'
  | 'SwarmWorkerStreamingComplete'
  | 'SwarmSubSessionRequested'
  | 'SwarmSubSessionBlocked'
  | 'SwarmSubSessionCompleted'
  | 'SwarmSubSessionError'
  | 'SwarmToolBlocked'
  | 'SwarmToolHandlerMissing'
  | 'SwarmToolError'
  | 'SwarmLeaderStarted'
  | 'SwarmLeaderCompleted'
  | 'SwarmLeaderError'
  | 'SwarmLeaderEmptySynthesis'
  | 'SwarmLeaderDelegationStarted'
  | 'SwarmLeaderDelegated'
  | 'SwarmLeaderDelegationError'
  | 'SwarmMemoryCommitCompleted'
  | 'SwarmMemoryCommitError'
  | 'SwarmPersistenceFailure'
  | 'SwarmChatroomSend'
  | 'ModelOverrideIgnored'
  | 'OverseerStartedDespiteLiveSibling'
  | 'OpenRouterGrok429Retry'
  | 'OpenRouterSlotSkip';

// ---------------------------------------------------------------------------
// Session Tracer — maps events to trace phases for Dev Console (#140)
// ---------------------------------------------------------------------------

const EVENT_TO_PHASE_TYPE: Partial<Record<TelemetryEventName, TracePhaseType>> = {
  LlmCallStarted: 'llm-call',
  LlmCallCompleted: 'llm-call',
  LlmCallFailed: 'llm-call',
  LlmFallbackTriggered: 'llm-call',
  LlmFallbackChainCompleted: 'llm-call',
  ToolExecuted: 'tool-dispatch',
  SubAgentToolExecuted: 'subagent',
  PromptShieldResult: 'verification',
  VerificationPipelineResult: 'verification',
  HumanConfirmationRequested: 'confirmation',
  HumanConfirmationReceived: 'confirmation',
  SkillMemoryInjected: 'memory',
  StateLoaded: 'memory',
  StateSaved: 'memory',
  PendingIntentCreated: 'orchestrator',
  PendingIntentRecovered: 'orchestrator',
  ChronoScheduledWakeRegistered: 'orchestrator',
  ChronoScheduledWakeDeferred: 'orchestrator',
  ChronoScheduledWakeTriggered: 'orchestrator',
  PausedTaskPaged: 'memory',
  PausedTaskResumeInjected: 'memory',
  LivingSessionIngressWindowOpened: 'orchestrator',
  LivingSessionNewMessageDrained: 'orchestrator',
  LivingSessionHookDrained: 'orchestrator',
  BufferedIngressQueued: 'orchestrator',
  BufferedIngressDequeued: 'orchestrator',
  BufferedIngressFallbackReplayed: 'orchestrator',
  ChronoBackplaneRead: 'memory',
  ChronoBackplaneWritten: 'memory',
  InterruptionBreadcrumbWritten: 'memory',
  InterruptionBreadcrumbRead: 'memory',
  TurnStarted: 'orchestrator',
  TurnCompleted: 'orchestrator',
  ContinueAsNewTriggered: 'orchestrator',
  DurableHookRegistered: 'orchestrator',
  DurableHookTriggered: 'orchestrator',
  DevLoopRelayPush: 'orchestrator',
  DevLoopRelayPoll: 'orchestrator',
  ExecutorVerifiedSetBinding: 'executor',
  ScopedTokenMinted: 'executor',
  HandlerTokenSource: 'executor',
  OrchestratorPlanCreated: 'orchestrator',
  PlanClassification: 'orchestrator',
  PlanGenerated: 'orchestrator',
  OboSessionBootstrapped: 'executor',
  SubAgentSpawned: 'subagent',
  MultiRoundDispatch: 'tool-dispatch',
  DiscoveryQueryExecuted: 'tool-dispatch',
  DiscoveryToolSubsetSelected: 'orchestrator',
  ModelProfileApplied: 'orchestrator',
  McpRegistryCatalogRefreshed: 'tool-dispatch',
  McpRegistrySearchExecuted: 'tool-dispatch',
  LimbicDecision: 'orchestrator',
  SteeringInjectionApplied: 'orchestrator',
  PolicyOverrideApplied: 'orchestrator',
  StaleAckRecoveryMessageEdited: 'reply-send',
  ClarificationRequested: 'orchestrator',
  ClarificationRetryRequested: 'orchestrator',
  ClarificationResumed: 'orchestrator',
  ClarificationCancelled: 'orchestrator',
  ClarificationExpired: 'orchestrator',
  BotMessageReceived: 'bot-receive',
  PromptBuilt: 'prompt-build',
  ReplySent: 'reply-send',
};

// ---------------------------------------------------------------------------
// Core tracking API
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  name: TelemetryEventName;
  correlationId: string;
  userId?: string;
  /** Additional structured payload — no raw PII, user IDs only */
  properties?: Record<string, string | number | boolean>;
}

/**
 * Emit a structured telemetry event. Creates an OpenTelemetry span event
 * attached to the current active span, or a new root span if none exists.
 */
export function trackEvent(event: TelemetryEvent): void {
  const activeSpan = trace.getActiveSpan();
  const attrs: Record<string, string | number | boolean> = {
    'helkinswarm.correlationId': event.correlationId,
    'helkinswarm.event': event.name,
  };
  if (event.userId) attrs['helkinswarm.userId'] = event.userId;
  if (event.properties) {
    for (const [k, v] of Object.entries(event.properties)) {
      attrs[`helkinswarm.${k}`] = v;
    }
  }

  if (activeSpan) {
    activeSpan.addEvent(event.name, attrs);
  } else {
    // No active span — create a one-shot span for the event
    const span = tracer.startSpan(event.name);
    span.setAttributes(attrs);
    span.end();
  }

  // Also record in session tracer for Dev Console (#140)
  const phaseType = EVENT_TO_PHASE_TYPE[event.name];
  if (phaseType) {
    const durationMs = typeof event.properties?.['durationMs'] === 'number' ? event.properties['durationMs'] : 0;
    const isError = event.name === 'LlmCallFailed' || (event.properties?.['error'] !== undefined);
    const detail = buildTraceDetail(event);

    recordTracePhase({
      correlationId: event.correlationId,
      userId: event.userId,
      phaseId: `${event.name}-${Date.now()}`,
      name: event.name,
      type: phaseType,
      durationMs,
      status: isError ? 'error' : 'completed',
      detail,
      error: isError ? String(event.properties?.['error'] ?? event.name) : undefined,
    });
  }
}

/** Build a human-readable detail string for trace phases */
function buildTraceDetail(event: TelemetryEvent): string {
  const parts: string[] = [];
  const p = event.properties;
  if (!p) return event.name;

  if (p['deployment']) parts.push(`model: ${p['deployment']}`);
  if (p['model']) parts.push(`model: ${p['model']}`);
  if (p['originalModel']) parts.push(`originalModel: ${p['originalModel']}`);
  if (p['fallbackModel']) parts.push(`fallbackModel: ${p['fallbackModel']}`);
  if (p['toolName']) parts.push(`tool: ${p['toolName']}`);
  if (p['executionKind']) parts.push(`executionKind: ${p['executionKind']}`);
  if (p['returnsControlTo']) parts.push(`returnsControlTo: ${p['returnsControlTo']}`);
  if (p['contextBoundary']) parts.push(`contextBoundary: ${p['contextBoundary']}`);
  if (p['totalTokens']) parts.push(`tokens: ${p['totalTokens']}`);
  if (p['promptTokens']) parts.push(`prompt: ${p['promptTokens']}`);
  if (p['completionTokens']) parts.push(`completion: ${p['completionTokens']}`);
  if (p['providerCost'] !== undefined) parts.push(`cost: ${p['providerCost']}${p['providerCostUnit'] ?? ''}`);
  if (p['result']) parts.push(`result: ${p['result']}`);
  if (p['skillDomain']) parts.push(`skill: ${p['skillDomain']}`);
  if (p['method']) parts.push(`method: ${p['method']}`);
  if (p['scopedTokenMethod']) parts.push(`method: ${p['scopedTokenMethod']}`);
  if (p['scope']) parts.push(`scope: ${p['scope']}`);
  if (p['scopedTokenScope']) parts.push(`scope: ${p['scopedTokenScope']}`);
  if (p['acquisition']) parts.push(`acquisition: ${p['acquisition']}`);
  if (p['source']) parts.push(`source: ${p['source']}`);
  if (p['handler']) parts.push(`handler: ${p['handler']}`);
  if (p['query']) parts.push(`query: ${p['query']}`);
  if (p['selectedTools']) parts.push(`selected: ${p['selectedTools']}`);
  if (p['trackingId']) parts.push(`trackingId: ${p['trackingId']}`);
  if (p['hookId']) parts.push(`hookId: ${p['hookId']}`);
  if (p['hookType']) parts.push(`hookType: ${p['hookType']}`);
  if (p['triggerType']) parts.push(`triggerType: ${p['triggerType']}`);
  if (p['creationReason']) parts.push(`creationReason: ${p['creationReason']}`);
  if (p['wakeId']) parts.push(`wakeId: ${p['wakeId']}`);
  if (p['wakeAt']) parts.push(`wakeAt: ${p['wakeAt']}`);
  if (p['nextWakeAt']) parts.push(`nextWakeAt: ${p['nextWakeAt']}`);
  if (p['pausedTaskId']) parts.push(`pausedTaskId: ${p['pausedTaskId']}`);
  if (p['previousCorrelationId']) parts.push(`previousCorrelationId: ${p['previousCorrelationId']}`);
  if (p['failureReason']) parts.push(`failureReason: ${p['failureReason']}`);
  if (p['authority']) parts.push(`authority: ${p['authority']}`);
  if (p['source']) parts.push(`source: ${p['source']}`);
  if (p['decision']) parts.push(`decision: ${p['decision']}`);
  if (p['reason']) parts.push(`reason: ${p['reason']}`);
  if (p['failoverSteps']) parts.push(`failoverSteps: ${p['failoverSteps']}`);
  if (p['type']) parts.push(`type: ${p['type']}`);
  if (p['interruptedInstanceId']) parts.push(`interruptedInstanceId: ${p['interruptedInstanceId']}`);
  if (p['interruptedCorrelationId']) parts.push(`interruptedCorrelationId: ${p['interruptedCorrelationId']}`);
  if (p['interruptedSource']) parts.push(`interruptedSource: ${p['interruptedSource']}`);
  if (p['interruptionDepth'] !== undefined) parts.push(`interruptionDepth: ${p['interruptionDepth']}`);
  if (p['interruptionDepthCap'] !== undefined) parts.push(`interruptionDepthCap: ${p['interruptionDepthCap']}`);
  if (p['instanceId']) parts.push(`instanceId: ${p['instanceId']}`);
  if (p['found'] !== undefined) parts.push(`found: ${p['found']}`);
  if (p['injected'] !== undefined) parts.push(`injected: ${p['injected']}`);
  if (p['deliveredToOverseer'] !== undefined) parts.push(`deliveredToOverseer: ${p['deliveredToOverseer']}`);
  if (p['hasInterruptionBreadcrumb'] !== undefined) parts.push(`hasInterruptionBreadcrumb: ${p['hasInterruptionBreadcrumb']}`);
  if (p['hasPausedTask'] !== undefined) parts.push(`hasPausedTask: ${p['hasPausedTask']}`);

  return parts.length > 0 ? parts.join(', ') : event.name;
}

/**
 * Start a traced operation. Returns a span that must be ended by the caller.
 * Use `endTracedOperation` to close it with proper status.
 */
export function startTracedOperation(
  operationName: string,
  correlationId: string,
  attrs?: Record<string, string | number | boolean>,
): Span {
  const span = tracer.startSpan(operationName);
  span.setAttribute('helkinswarm.correlationId', correlationId);
  if (attrs) span.setAttributes(attrs);
  return span;
}

/**
 * End a traced operation with success or error status.
 */
export function endTracedOperation(span: Span, error?: Error): void {
  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}
