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

/** Resolve execution hints for a tool from the generated plan. */
export function resolveExecutionHint(
  toolName: string,
  toolDefinition: ToolDefinitionLike | undefined,
  planSteps: readonly PlanStep[] | null | undefined,
): ToolExecutionHint {
  const matchingStep = planSteps
    ?.filter((step) => step.toolHint === toolName)
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
): PlannedToolCall[] {
  return toolCalls
    .map((call, index) => {
      const hint = resolveExecutionHint(call.name, undefined, planSteps);
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