export interface GuardedToolLike {
  privilegeClass?: string;
}

export interface GuardedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface GuardedToolResultLike {
  toolCallId: string;
  toolName: string;
  success: boolean;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

export function isMutatingTool(tool: GuardedToolLike | undefined): boolean {
  return !!tool && tool.privilegeClass !== undefined && tool.privilegeClass !== 'read-only';
}

export function buildToolCallFingerprint(name: string, rawArguments: string): string {
  try {
    return `${name}:${stableSerialize(JSON.parse(rawArguments) as unknown)}`;
  } catch {
    return `${name}:${rawArguments.trim()}`;
  }
}

export function buildDuplicateSuppressedToolResult(call: GuardedToolCall): {
  toolCallId: string;
  toolName: string;
  success: true;
  result: { status: 'duplicate-suppressed'; message: string };
  requiresExecutor: false;
} {
  return {
    toolCallId: call.id,
    toolName: call.name,
    success: true,
    result: {
      status: 'duplicate-suppressed',
      message: `Suppressed duplicate ${call.name} call because an identical mutating action already succeeded earlier in this turn.`,
    },
    requiresExecutor: false,
  };
}

export function recordSuccessfulMutatingFingerprints(
  calls: readonly GuardedToolCall[],
  results: readonly GuardedToolResultLike[],
  resolveTool: (toolName: string) => GuardedToolLike | undefined,
  target: Set<string>,
): void {
  const callsById = new Map(calls.map((call) => [call.id, call]));

  for (const result of results) {
    if (!result.success) {
      continue;
    }

    const call = callsById.get(result.toolCallId);
    if (!call) {
      continue;
    }

    if (!isMutatingTool(resolveTool(call.name))) {
      continue;
    }

    target.add(buildToolCallFingerprint(call.name, call.arguments));
  }
}