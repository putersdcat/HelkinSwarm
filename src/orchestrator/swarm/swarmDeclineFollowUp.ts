interface ToolCallLike {
  id: string;
  name: string;
  arguments: string;
}

interface ToolResultLike {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}

const SWARM_DECLINE_RESULT_TEXT = 'Swarm activation was declined by the decomposer. The swarm did not run. Answer directly and do not claim that Benjamin, Harper, or Lucas are currently researching.';

export function sanitizeSwarmDeclineFollowUpContext(input: {
  toolCalls: ReadonlyArray<ToolCallLike>;
  toolResults: ReadonlyArray<ToolResultLike>;
  declineReason?: string;
}): { toolCalls: ToolCallLike[]; toolResults: ToolResultLike[] } {
  const toolCalls = input.toolCalls.filter((call) => call.name !== 'activate_swarm');

  let foundDeclinedResult = false;
  const toolResults = input.toolResults.map((result) => {
    if (result.toolName !== 'activate_swarm') {
      return { ...result };
    }

    foundDeclinedResult = true;
    return {
      ...result,
      success: false,
      result: SWARM_DECLINE_RESULT_TEXT,
      error: input.declineReason ?? result.error,
    };
  });

  if (!foundDeclinedResult) {
    toolResults.unshift({
      toolCallId: 'activate_swarm-declined',
      toolName: 'activate_swarm',
      success: false,
      result: SWARM_DECLINE_RESULT_TEXT,
      error: input.declineReason,
    });
  }

  return { toolCalls, toolResults };
}

export function shouldShortCircuitSwarmDecline(toolResults: ReadonlyArray<ToolResultLike>): boolean {
  return !toolResults.some((result) => result.toolName !== 'activate_swarm' && result.success);
}

export function buildSwarmDeclineDirectResponse(declineReason?: string): string {
  const reason = declineReason?.trim();
  const suffix = reason ? ` (${reason.slice(0, 160)})` : '';
  return `⚡ Swarm activation could not complete${suffix}. I do not have a trustworthy multi-agent result for this turn, so please retry in a moment.`;
}
