// Session Tracer — collects telemetry events per correlation ID and builds
// a causal trace tree for the Dev Console Session Tracer panel.
// Spec ref: ADDENDA-03 (Tab Infrastructure), Issue #140
//
// This is an in-memory ring buffer — traces are ephemeral and lost on restart.
// For durable tracing, App Insights / OpenTelemetry is the source of truth.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TracePhaseType =
  | 'bot-receive'     // Message received from Teams (#269)
  | 'prompt-build'    // Prompt assembly (#269)
  | 'llm-call'        // LLM request/response (#269 — replaces 'llm')
  | 'tool-dispatch'   // Low-risk tool dispatch (#269 — replaces 'tool')
  | 'subagent'        // Sub-agent tool execution (#269)
  | 'executor'        // High-risk executor activity (#269)
  | 'confirmation'    // Human confirmation gate (#269)
  | 'reply-send'      // Reply sent to Teams (#269 — replaces 'reply')
  | 'verification'    // Safety verification pipeline
  | 'memory'          // Memory read/write
  | 'orchestrator'    // Orchestrator lifecycle
  // Legacy aliases — kept for backward compat
  | 'llm'
  | 'tool'
  | 'reply';
export type TracePhaseStatus = 'running' | 'completed' | 'error';

export interface TracePhase {
  id: string;
  name: string;
  type: TracePhaseType;
  startedAt: number;   // ms offset from turn start
  durationMs: number;
  status: TracePhaseStatus;
  children: TracePhase[];
  detail?: string;
  error?: string;
}

export interface TraceTree {
  correlationId: string;
  userId?: string;
  turnStartedAt: string; // ISO timestamp
  totalMs: number;
  phases: TracePhase[];
}

// ---------------------------------------------------------------------------
// In-memory trace store (ring buffer — bounded at MAX_TRACES)
// ---------------------------------------------------------------------------

const MAX_TRACES = 200;
const traceMap = new Map<string, TraceTree>();
const traceOrder: string[] = [];

function evictOldest(): void {
  while (traceOrder.length > MAX_TRACES) {
    const oldest = traceOrder.shift();
    if (oldest) traceMap.delete(oldest);
  }
}

function getOrCreateTrace(correlationId: string, userId?: string): TraceTree {
  let tree = traceMap.get(correlationId);
  if (!tree) {
    tree = {
      correlationId,
      userId,
      turnStartedAt: new Date().toISOString(),
      totalMs: 0,
      phases: [],
    };
    traceMap.set(correlationId, tree);
    traceOrder.push(correlationId);
    evictOldest();
  }
  return tree;
}

// ---------------------------------------------------------------------------
// Recording API — called from telemetry instrumentation points
// ---------------------------------------------------------------------------

export interface RecordPhaseInput {
  correlationId: string;
  userId?: string;
  phaseId: string;
  name: string;
  type: TracePhaseType;
  durationMs: number;
  status: TracePhaseStatus;
  parentPhaseId?: string;
  detail?: string;
  error?: string;
}

/**
 * Record a phase in the trace tree for a given correlation ID.
 * Phases are added to the root or as children of an existing parent.
 */
export function recordTracePhase(input: RecordPhaseInput): void {
  const tree = getOrCreateTrace(input.correlationId, input.userId);

  const phase: TracePhase = {
    id: input.phaseId,
    name: input.name,
    type: input.type,
    startedAt: Date.now() - new Date(tree.turnStartedAt).getTime(),
    durationMs: input.durationMs,
    status: input.status,
    children: [],
    detail: input.detail,
    error: input.error,
  };

  if (input.parentPhaseId) {
    const parent = findPhase(tree.phases, input.parentPhaseId);
    if (parent) {
      parent.children.push(phase);
    } else {
      // Parent not found — add at root as fallback
      tree.phases.push(phase);
    }
  } else {
    tree.phases.push(phase);
  }

  // Recompute total duration
  tree.totalMs = computeTotalMs(tree.phases);
}

/**
 * Mark a running phase as completed.
 */
export function completeTracePhase(
  correlationId: string,
  phaseId: string,
  durationMs: number,
  status: TracePhaseStatus = 'completed',
  error?: string,
): void {
  const tree = traceMap.get(correlationId);
  if (!tree) return;

  const phase = findPhase(tree.phases, phaseId);
  if (phase) {
    phase.durationMs = durationMs;
    phase.status = status;
    if (error) phase.error = error;
  }

  tree.totalMs = computeTotalMs(tree.phases);
}

// ---------------------------------------------------------------------------
// Query API — used by the Dev Console endpoint
// ---------------------------------------------------------------------------

/**
 * Get the trace tree for a correlation ID.
 */
export function getTraceTree(correlationId: string): TraceTree | undefined {
  return traceMap.get(correlationId);
}

/**
 * Find the most recent trace tree whose full correlationId starts with a short footer token.
 * Footer telemetry only exposes the first 8 chars (corr:xxxxxxxx), while the runtime keeps
 * the full UUID correlationId in-memory.
 */
export function findTraceTreeByShortCorrelation(shortCorrelation: string): TraceTree | undefined {
  const normalized = shortCorrelation
    .trim()
    .replace(/^\[?corr:/i, '')
    .replace(/\]?$/u, '')
    .toLowerCase();

  if (normalized.length === 0) {
    return undefined;
  }

  for (let i = traceOrder.length - 1; i >= 0; i--) {
    const tree = traceMap.get(traceOrder[i]);
    if (tree && tree.correlationId.toLowerCase().startsWith(normalized)) {
      return tree;
    }
  }

  return undefined;
}

export interface TraceListFilter {
  limit?: number;
  sinceIso?: string; // ISO timestamp — only traces after this time
  untilIso?: string; // ISO timestamp — only traces before this time
}

/**
 * List recent trace trees (most recent first) with optional time range filtering (#269).
 */
export function listRecentTraces(limitOrFilter: number | TraceListFilter = 20): Array<{ correlationId: string; turnStartedAt: string; totalMs: number; phaseCount: number }> {
  const opts: TraceListFilter = typeof limitOrFilter === 'number'
    ? { limit: limitOrFilter }
    : limitOrFilter;
  const limit = opts.limit ?? 20;
  const sinceMs = opts.sinceIso ? new Date(opts.sinceIso).getTime() : 0;
  const untilMs = opts.untilIso ? new Date(opts.untilIso).getTime() : Infinity;

  const results: Array<{ correlationId: string; turnStartedAt: string; totalMs: number; phaseCount: number }> = [];
  for (let i = traceOrder.length - 1; i >= 0 && results.length < limit; i--) {
    const tree = traceMap.get(traceOrder[i]);
    if (tree) {
      const treeMs = new Date(tree.turnStartedAt).getTime();
      if (treeMs < sinceMs || treeMs > untilMs) continue;
      results.push({
        correlationId: tree.correlationId,
        turnStartedAt: tree.turnStartedAt,
        totalMs: tree.totalMs,
        phaseCount: countPhases(tree.phases),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPhase(phases: TracePhase[], id: string): TracePhase | undefined {
  for (const p of phases) {
    if (p.id === id) return p;
    const child = findPhase(p.children, id);
    if (child) return child;
  }
  return undefined;
}

function computeTotalMs(phases: TracePhase[]): number {
  let max = 0;
  for (const p of phases) {
    const end = p.startedAt + p.durationMs;
    if (end > max) max = end;
  }
  return max;
}

function countPhases(phases: TracePhase[]): number {
  let count = phases.length;
  for (const p of phases) {
    count += countPhases(p.children);
  }
  return count;
}
