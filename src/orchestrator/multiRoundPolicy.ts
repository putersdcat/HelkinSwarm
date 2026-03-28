export type MultiRoundRisk = 'low' | 'medium' | 'high';

export interface MultiRoundToolLike {
  risk?: MultiRoundRisk;
  requiresExecutor?: boolean;
  requiresConfirmation?: boolean;
}

/**
 * Multi-round tool policy:
 * - executor-backed tools are never allowed here
 * - low/medium-risk tools are allowed
 * - high-risk tools are allowed only when they explicitly skip confirmation
 *   in the current environment, otherwise they must stay on the guarded path
 */
export function canExecuteInMultiRound(tool: MultiRoundToolLike | undefined): boolean {
  if (!tool) return false;
  if (tool.requiresExecutor) return false;
  if (tool.risk === 'high') {
    return tool.requiresConfirmation === false;
  }
  return true;
}

/** Highest risk present in a candidate multi-round batch. */
export function getHighestMultiRoundRisk(
  tools: readonly MultiRoundToolLike[],
): MultiRoundRisk {
  if (tools.some((tool) => tool.risk === 'high')) return 'high';
  if (tools.some((tool) => tool.risk === 'medium')) return 'medium';
  return 'low';
}

/** Whether the whole batch can skip human confirmation in confirmation-gated mode. */
export function shouldSkipConfirmationForMultiRound(
  tools: readonly MultiRoundToolLike[],
): boolean {
  return tools.length > 0 && tools.every((tool) => tool.requiresConfirmation === false);
}