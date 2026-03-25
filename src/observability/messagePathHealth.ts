// Message-path health tracker — lightweight in-memory signal for /api/messages.
// Helps /api/health report recent webhook/turn failures instead of always
// claiming the runtime is healthy.

export type MessagePathStatus = 'ok' | 'degraded' | 'error';

export interface MessagePathSnapshot {
  status: MessagePathStatus;
  pendingTurns: number;
  oldestPendingAgeMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

interface PendingTurn {
  startedAtMs: number;
}

const pendingTurns = new Map<string, PendingTurn>();

let lastSuccessAtMs: number | null = null;
let lastFailureAtMs: number | null = null;
let lastFailureReason: string | null = null;

const STUCK_TURN_THRESHOLD_MS = 30_000;
const RECENT_FAILURE_WINDOW_MS = 10 * 60_000;

export function recordMessagePathStart(turnId: string, startedAtMs = Date.now()): void {
  pendingTurns.set(turnId, { startedAtMs });
}

export function recordMessagePathSuccess(turnId: string, completedAtMs = Date.now()): void {
  pendingTurns.delete(turnId);
  lastSuccessAtMs = completedAtMs;

  if (lastFailureAtMs !== null && completedAtMs >= lastFailureAtMs) {
    lastFailureAtMs = null;
    lastFailureReason = null;
  }
}

export function recordMessagePathFailure(
  turnId: string,
  reason: string,
  failedAtMs = Date.now(),
): void {
  pendingTurns.delete(turnId);
  lastFailureAtMs = failedAtMs;
  lastFailureReason = reason;
}

export function recordMessagePathGlobalFailure(reason: string, failedAtMs = Date.now()): void {
  lastFailureAtMs = failedAtMs;
  lastFailureReason = reason;
}

export function getMessagePathSnapshot(nowMs = Date.now()): MessagePathSnapshot {
  let oldestPendingAgeMs: number | null = null;
  for (const pending of pendingTurns.values()) {
    const age = nowMs - pending.startedAtMs;
    if (oldestPendingAgeMs === null || age > oldestPendingAgeMs) {
      oldestPendingAgeMs = age;
    }
  }

  const hasStuckTurn = oldestPendingAgeMs !== null && oldestPendingAgeMs >= STUCK_TURN_THRESHOLD_MS;
  const hasRecentFailure =
    lastFailureAtMs !== null &&
    nowMs - lastFailureAtMs <= RECENT_FAILURE_WINDOW_MS &&
    (lastSuccessAtMs === null || lastSuccessAtMs < lastFailureAtMs);

  const status: MessagePathStatus = hasStuckTurn
    ? 'error'
    : hasRecentFailure
      ? 'degraded'
      : 'ok';

  return {
    status,
    pendingTurns: pendingTurns.size,
    oldestPendingAgeMs,
    lastSuccessAt: lastSuccessAtMs === null ? null : new Date(lastSuccessAtMs).toISOString(),
    lastFailureAt: lastFailureAtMs === null ? null : new Date(lastFailureAtMs).toISOString(),
    lastFailureReason,
  };
}

export function resetMessagePathHealth(): void {
  pendingTurns.clear();
  lastSuccessAtMs = null;
  lastFailureAtMs = null;
  lastFailureReason = null;
}