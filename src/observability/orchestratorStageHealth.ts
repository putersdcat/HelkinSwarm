export interface ActiveTurnStage {
  correlationId: string;
  userId?: string;
  stage: string;
  startedAtMs: number;
  updatedAtMs: number;
}

const activeTurns = new Map<string, ActiveTurnStage>();

export function recordOrchestratorStage(
  correlationId: string,
  stage: string,
  userId?: string,
  nowMs = Date.now(),
): void {
  const existing = activeTurns.get(correlationId);
  activeTurns.set(correlationId, {
    correlationId,
    userId: userId ?? existing?.userId,
    stage,
    startedAtMs: existing?.startedAtMs ?? nowMs,
    updatedAtMs: nowMs,
  });
}

export function clearOrchestratorStage(correlationId: string): void {
  activeTurns.delete(correlationId);
}

export function getOrchestratorStageSnapshot(nowMs = Date.now()): {
  activeTurns: number;
  oldestAgeMs: number | null;
  turns: Array<{
    correlationId: string;
    userId?: string;
    stage: string;
    ageMs: number;
    updatedAt: string;
  }>;
} {
  const turns = Array.from(activeTurns.values())
    .map((entry) => ({
      correlationId: entry.correlationId,
      userId: entry.userId,
      stage: entry.stage,
      ageMs: nowMs - entry.startedAtMs,
      updatedAt: new Date(entry.updatedAtMs).toISOString(),
    }))
    .sort((a, b) => b.ageMs - a.ageMs);

  return {
    activeTurns: turns.length,
    oldestAgeMs: turns.length > 0 ? turns[0]!.ageMs : null,
    turns: turns.slice(0, 10),
  };
}

export function resetOrchestratorStageHealth(): void {
  activeTurns.clear();
}