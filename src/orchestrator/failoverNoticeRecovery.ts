import {
  buildSuccessfulFailoverNotices,
  type LlmFailoverStep,
} from '../llm/foundryClient.js';
import { getTraceTree, type TracePhase, type TraceTree } from '../observability/sessionTracer.js';

function flattenTracePhases(phases: readonly TracePhase[]): TracePhase[] {
  const flattened: TracePhase[] = [];
  for (const phase of phases) {
    flattened.push(phase);
    flattened.push(...flattenTracePhases(phase.children));
  }
  return flattened;
}

function extractDetailValue(detail: string | undefined, key: string): string | undefined {
  if (!detail) {
    return undefined;
  }

  const match = detail.match(new RegExp(`${key}: ([^,]+)`));
  return match?.[1]?.trim();
}

export function extractFailoverStepsFromTraceTree(tree: Pick<TraceTree, 'phases'> | null | undefined): LlmFailoverStep[] {
  if (!tree) {
    return [];
  }

  const steps: Array<LlmFailoverStep | undefined> = flattenTracePhases(tree.phases)
    .filter((phase) => phase.name === 'LlmFallbackTriggered')
    .map((phase) => {
      const fromModel = extractDetailValue(phase.detail, 'originalModel');
      const toModel = extractDetailValue(phase.detail, 'fallbackModel');
      const reason = extractDetailValue(phase.detail, 'reason') ?? 'error';
      const statusCodeMatch = reason.match(/^HTTP\s+(\d{3})$/i);

      if (!fromModel || !toModel) {
        return undefined;
      }

      return {
        fromModel,
        toModel,
        reason,
        statusCode: statusCodeMatch ? Number(statusCodeMatch[1]) : undefined,
      } satisfies LlmFailoverStep;
    });

  return steps.filter((step): step is LlmFailoverStep => step !== undefined);
}

export function recoverOperationalNoticesFromTrace(correlationId: string): string[] {
  const traceTree = getTraceTree(correlationId);
  return buildSuccessfulFailoverNotices(extractFailoverStepsFromTraceTree(traceTree));
}