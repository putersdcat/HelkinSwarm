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
  result?: unknown;
  error?: string;
  requiresExecutor?: boolean;
  scopedTokenMinted?: boolean;
  scopedTokenMethod?: 'obo' | 'placeholder';
  scopedTokenScope?: 'read' | 'write' | 'delete' | 'admin';
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter((item) => item.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function normalizeInlineAssets(value: unknown): Array<{ assetId: string; contentId: string; fileName?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const assetId = typeof record['assetId'] === 'string' ? record['assetId'].trim() : '';
      const contentId = typeof record['contentId'] === 'string' ? record['contentId'].trim().toLowerCase() : '';
      const fileName = typeof record['fileName'] === 'string' && record['fileName'].trim().length > 0
        ? record['fileName'].trim()
        : undefined;

      if (!assetId || !contentId) {
        return null;
      }

      return fileName ? { assetId, contentId, fileName } : { assetId, contentId };
    })
    .filter((item): item is { assetId: string; contentId: string; fileName?: string } => !!item)
    .sort((a, b) => `${a.contentId}:${a.assetId}:${a.fileName ?? ''}`.localeCompare(`${b.contentId}:${b.assetId}:${b.fileName ?? ''}`));
}

function normalizeToolArguments(name: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  if (name === 'outlook_list_emails') {
    const top = typeof record['top'] === 'number' && Number.isFinite(record['top'])
      ? Math.min(Math.max(Math.trunc(record['top']), 1), 50)
      : 10;
    const folder = typeof record['folder'] === 'string' && record['folder'].trim().length > 0
      ? record['folder'].trim().toLowerCase()
      : 'inbox';
    const filter = typeof record['filter'] === 'string' && record['filter'].trim().length > 0
      ? record['filter'].trim().replace(/\s+/g, ' ').toLowerCase()
      : undefined;

    return {
      top,
      folder,
      ...(filter ? { filter } : {}),
    };
  }

  if (name === 'outlook_send_email') {
    return {
      to: normalizeStringArray(record['to']),
      subject: typeof record['subject'] === 'string' ? record['subject'] : '',
      body: typeof record['body'] === 'string' ? record['body'] : '',
      bodyType: typeof record['bodyType'] === 'string' && record['bodyType'].trim().length > 0
        ? record['bodyType'].trim().toLowerCase()
        : 'text',
      cc: normalizeStringArray(record['cc']),
      attachmentAssetIds: normalizeStringArray(record['attachmentAssetIds']),
      inlineAssets: normalizeInlineAssets(record['inlineAssets']),
    };
  }

  return value;
}

export function isMutatingTool(tool: GuardedToolLike | undefined): boolean {
  return !!tool && tool.privilegeClass !== undefined && tool.privilegeClass !== 'read-only';
}

export function isReplayableReadOnlyTool(tool: GuardedToolLike | undefined): boolean {
  return !!tool && tool.privilegeClass === 'read-only';
}

export function buildToolCallFingerprint(name: string, rawArguments: string): string {
  try {
    return `${name}:${stableSerialize(normalizeToolArguments(name, JSON.parse(rawArguments) as unknown))}`;
  } catch {
    return `${name}:${rawArguments.trim()}`;
  }
}

export function buildDuplicateSuppressedToolResult(call: GuardedToolCall): {
  toolCallId: string;
  toolName: string;
  success: true;
  result: { status: 'duplicate-suppressed'; deliveredEarlierInTurn: true; message: string };
  requiresExecutor: false;
} {
  return {
    toolCallId: call.id,
    toolName: call.name,
    success: true,
    result: {
      status: 'duplicate-suppressed',
      deliveredEarlierInTurn: true,
      message: `An identical ${call.name} action already succeeded earlier in this turn. This duplicate retry was suppressed, so the original action should still be treated as completed and no second side effect was emitted.`,
    },
    requiresExecutor: false,
  };
}

export function buildDuplicateReplayedToolResult(
  call: GuardedToolCall,
  previousResult: GuardedToolResultLike,
): {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  requiresExecutor: boolean;
  scopedTokenMinted?: boolean;
  scopedTokenMethod?: 'obo' | 'placeholder';
  scopedTokenScope?: 'read' | 'write' | 'delete' | 'admin';
} {
  return {
    toolCallId: call.id,
    toolName: call.name,
    success: previousResult.success,
    ...(previousResult.result !== undefined ? { result: previousResult.result } : {}),
    ...(previousResult.error !== undefined ? { error: previousResult.error } : {}),
    requiresExecutor: previousResult.requiresExecutor ?? false,
    ...(previousResult.scopedTokenMinted !== undefined ? { scopedTokenMinted: previousResult.scopedTokenMinted } : {}),
    ...(previousResult.scopedTokenMethod !== undefined ? { scopedTokenMethod: previousResult.scopedTokenMethod } : {}),
    ...(previousResult.scopedTokenScope !== undefined ? { scopedTokenScope: previousResult.scopedTokenScope } : {}),
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

export function recordSuccessfulReplayableReadOnlyResults(
  calls: readonly GuardedToolCall[],
  results: readonly GuardedToolResultLike[],
  resolveTool: (toolName: string) => GuardedToolLike | undefined,
  target: Map<string, GuardedToolResultLike>,
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

    if (!isReplayableReadOnlyTool(resolveTool(call.name))) {
      continue;
    }

    target.set(buildToolCallFingerprint(call.name, call.arguments), result);
  }
}