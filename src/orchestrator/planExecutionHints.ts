import type { StepModel, PlanStep } from './planActivity.js';

export interface PlannedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolDefinitionLike {
  requiresSubAgent?: boolean;
}

export interface ToolExecutionHint {
  stepOrder?: number;
  preferredModel?: StepModel;
  useSubAgent: boolean;
  tokenScope?: string;
  matchedPlanStep: boolean;
}

export interface ToolExecutionResultLike {
  toolName: string;
  success: boolean;
}

export interface PlanDispatchBatch {
  selectedCalls: PlannedToolCall[];
  deferredCalls: PlannedToolCall[];
  readyStepOrders: number[];
  readyToolHints: string[];
  planConstrained: boolean;
}

/** Resolve execution hints for a tool from the generated plan. */
export function resolveExecutionHint(
  toolName: string,
  toolDefinition: ToolDefinitionLike | undefined,
  planSteps: readonly PlanStep[] | null | undefined,
  completedStepOrders: readonly number[] = [],
): ToolExecutionHint {
  const completed = new Set(completedStepOrders);
  const matchingStep = planSteps
    ?.filter((step) => step.toolHint === toolName && !completed.has(step.order))
    .sort((a, b) => a.order - b.order)[0];

  return {
    stepOrder: matchingStep?.order,
    preferredModel: matchingStep?.model,
    useSubAgent: Boolean(toolDefinition?.requiresSubAgent || matchingStep?.useSubAgent),
    tokenScope: matchingStep?.tokenScope,
    matchedPlanStep: Boolean(matchingStep),
  };
}

/**
 * Stable-sort tool calls using the generated plan order when the plan names specific tools.
 * Unmatched tools preserve their original relative order after all matched steps.
 */
export function sortToolCallsByPlan(
  toolCalls: readonly PlannedToolCall[],
  planSteps: readonly PlanStep[] | null | undefined,
  completedStepOrders: readonly number[] = [],
): PlannedToolCall[] {
  return toolCalls
    .map((call, index) => {
      const hint = resolveExecutionHint(call.name, undefined, planSteps, completedStepOrders);
      return {
        call,
        index,
        stepOrder: hint.stepOrder ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => {
      if (left.stepOrder !== right.stepOrder) {
        return left.stepOrder - right.stepOrder;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.call);
}

/**
 * Select the subset of tool calls that match the next ready planned step(s).
 * When a plan has matched tool hints remaining, only the ready lowest-order
 * step(s) are selected for dispatch; later-step calls are deferred.
 */
export function selectReadyToolCallsByPlan(
  toolCalls: readonly PlannedToolCall[],
  planSteps: readonly PlanStep[] | null | undefined,
  completedStepOrders: readonly number[] = [],
): PlanDispatchBatch {
  if (!planSteps || planSteps.length === 0) {
    return {
      selectedCalls: [...toolCalls],
      deferredCalls: [],
      readyStepOrders: [],
      readyToolHints: [],
      planConstrained: false,
    };
  }

  const completed = new Set(completedStepOrders);
  const remainingMatchedSteps = planSteps
    .filter((step) => !!step.toolHint && !completed.has(step.order));

  if (remainingMatchedSteps.length === 0) {
    return {
      selectedCalls: [...toolCalls],
      deferredCalls: [],
      readyStepOrders: [],
      readyToolHints: [],
      planConstrained: false,
    };
  }

  const readySteps = remainingMatchedSteps
    .filter((step) => (step.dependsOn ?? []).every((dep) => completed.has(dep)));

  if (readySteps.length === 0) {
    return {
      selectedCalls: [],
      deferredCalls: [...toolCalls],
      readyStepOrders: [],
      readyToolHints: [],
      planConstrained: true,
    };
  }

  const nextOrder = Math.min(...readySteps.map((step) => step.order));
  const readyHints = [...new Set(
    readySteps
      .filter((step) => step.order === nextOrder)
      .map((step) => step.toolHint)
      .filter((toolHint): toolHint is string => typeof toolHint === 'string' && toolHint.length > 0),
  )];

  if (readyHints.length === 0) {
    return {
      selectedCalls: [...toolCalls],
      deferredCalls: [],
      readyStepOrders: [nextOrder],
      readyToolHints: [],
      planConstrained: false,
    };
  }

  const readyHintSet = new Set(readyHints);
  const selectedCalls = toolCalls.filter((call) => readyHintSet.has(call.name));
  const deferredCalls = toolCalls.filter((call) => !readyHintSet.has(call.name));

  return {
    selectedCalls,
    deferredCalls,
    readyStepOrders: readySteps.filter((step) => step.order === nextOrder).map((step) => step.order),
    readyToolHints: readyHints,
    planConstrained: true,
  };
}

/**
 * Mark matched plan steps complete based on successful tool executions.
 * For repeated tool names, completion advances in plan order.
 */
export function collectCompletedPlanStepOrders(
  results: readonly ToolExecutionResultLike[],
  planSteps: readonly PlanStep[] | null | undefined,
  completedStepOrders: readonly number[] = [],
): number[] {
  if (!planSteps || planSteps.length === 0) {
    return [...completedStepOrders].sort((a, b) => a - b);
  }

  const completed = new Set(completedStepOrders);

  for (const result of results) {
    if (!result.success) continue;

    const matchingStep = planSteps
      .filter((step) => step.toolHint === result.toolName && !completed.has(step.order))
      .sort((a, b) => a.order - b.order)[0];

    if (matchingStep) {
      completed.add(matchingStep.order);
    }
  }

  return [...completed].sort((a, b) => a - b);
}