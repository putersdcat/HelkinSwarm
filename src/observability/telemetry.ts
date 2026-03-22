// Structured telemetry — consistent event emission with correlation IDs.
// All key events flow through here to ensure uniform schema in App Insights.
// Spec ref: 13-Observability-Monitoring.md, issues #84, #85
//
// Uses OpenTelemetry trace API + span events to emit structured custom events.
// The @azure/monitor-opentelemetry exporter (initialized in functions/index.ts)
// automatically forwards these to App Insights.

import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { recordTracePhase, type TracePhaseType } from './sessionTracer.js';

const tracer = trace.getTracer('helkinswarm', '0.1.0');

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
  | 'GraphNotificationProcessed'
  | 'GraphSubscriptionRenewed'
  | 'StateLoaded'
  | 'StateSaved';

// ---------------------------------------------------------------------------
// Session Tracer — maps events to trace phases for Dev Console (#140)
// ---------------------------------------------------------------------------

const EVENT_TO_PHASE_TYPE: Partial<Record<TelemetryEventName, TracePhaseType>> = {
  LlmCallStarted: 'llm',
  LlmCallCompleted: 'llm',
  LlmCallFailed: 'llm',
  ToolExecuted: 'tool',
  SubAgentToolExecuted: 'tool',
  VerificationPipelineResult: 'verification',
  HumanConfirmationRequested: 'verification',
  HumanConfirmationReceived: 'verification',
  SkillMemoryInjected: 'memory',
  StateLoaded: 'memory',
  StateSaved: 'memory',
  TurnStarted: 'orchestrator',
  TurnCompleted: 'orchestrator',
  ContinueAsNewTriggered: 'orchestrator',
  DurableHookRegistered: 'orchestrator',
  DurableHookTriggered: 'orchestrator',
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
  if (p['toolName']) parts.push(`tool: ${p['toolName']}`);
  if (p['totalTokens']) parts.push(`tokens: ${p['totalTokens']}`);
  if (p['promptTokens']) parts.push(`prompt: ${p['promptTokens']}`);
  if (p['completionTokens']) parts.push(`completion: ${p['completionTokens']}`);
  if (p['result']) parts.push(`result: ${p['result']}`);
  if (p['skillDomain']) parts.push(`skill: ${p['skillDomain']}`);

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
