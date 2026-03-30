import { getContainer } from '../memory/cosmosClient.js';

export interface ActiveTurnStage {
  correlationId: string;
  userId: string;
  stage: string;
  startedAtMs: number;
  updatedAtMs: number;
}

interface OrchestratorStageDocument extends ActiveTurnStage {
  id: string;
  type: 'orchestrator-stage';
  ttl: number;
}

const CLEARED_STAGE = 'cleared';
const CLEARED_STAGE_TTL_SECONDS = 60;

const SESSIONS_CONTAINER = 'sessions';
const STAGE_TTL_SECONDS = 15 * 60;
const STAGE_IO_TIMEOUT_MS = 1_000;
const STAGE_TTL_MS = STAGE_TTL_SECONDS * 1_000;
const activeTurns = new Map<string, ActiveTurnStage>();

function isStageEntryFresh(
  entry: Pick<ActiveTurnStage, 'startedAtMs' | 'updatedAtMs'>,
  nowMs: number,
): boolean {
  return nowMs - Math.max(entry.startedAtMs, entry.updatedAtMs) < STAGE_TTL_MS;
}

function makeStageDocId(correlationId: string): string {
  return `stage-${correlationId}`;
}

function isVisibleStage(entry: Pick<ActiveTurnStage, 'stage'>): boolean {
  return entry.stage !== CLEARED_STAGE;
}

function mergeFreshStageEntries(
  persistedEntries: ActiveTurnStage[],
  inMemoryEntries: ActiveTurnStage[],
  nowMs: number,
): ActiveTurnStage[] {
  const merged = new Map<string, ActiveTurnStage>();

  const consider = (entry: ActiveTurnStage) => {
    if (!isStageEntryFresh(entry, nowMs) || !isVisibleStage(entry)) {
      return;
    }

    const existing = merged.get(entry.correlationId);
    if (!existing || entry.updatedAtMs >= existing.updatedAtMs) {
      merged.set(entry.correlationId, entry);
    }
  };

  for (const entry of persistedEntries) {
    consider(entry);
  }
  for (const entry of inMemoryEntries) {
    consider(entry);
  }

  return Array.from(merged.values());
}

function buildClearedStageDocument(
  correlationId: string,
  userId: string,
  nowMs: number,
  startedAtMs = nowMs,
): OrchestratorStageDocument {
  return {
    id: makeStageDocId(correlationId),
    type: 'orchestrator-stage',
    correlationId,
    userId,
    stage: CLEARED_STAGE,
    startedAtMs,
    updatedAtMs: nowMs,
    ttl: CLEARED_STAGE_TTL_SECONDS,
  };
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`orchestratorStageHealth timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function recordOrchestratorStage(
  correlationId: string,
  stage: string,
  userId: string,
  nowMs = Date.now(),
): Promise<void> {
  const existing = activeTurns.get(correlationId);
  const entry: ActiveTurnStage = {
    correlationId,
    userId,
    stage,
    startedAtMs: existing?.startedAtMs ?? nowMs,
    updatedAtMs: nowMs,
  };

  activeTurns.set(correlationId, entry);

  const doc: OrchestratorStageDocument = {
    id: makeStageDocId(correlationId),
    type: 'orchestrator-stage',
    correlationId,
    userId,
    stage,
    startedAtMs: entry.startedAtMs,
    updatedAtMs: nowMs,
    ttl: STAGE_TTL_SECONDS,
  };

  try {
    const container = getContainer(SESSIONS_CONTAINER);
    await withTimeout(container.items.upsert(doc), STAGE_IO_TIMEOUT_MS);
  } catch {
    // Best-effort only — in-memory fallback remains available.
  }
}

/**
 * Record a substage with in-memory tracking only — no Cosmos write.
 * Use inside hot paths (buildPrompt, etc.) where multiple stage updates per activity
 * would over-saturate Cosmos connections and stall the event loop (#327).
 */
export function recordSubstage(
  correlationId: string,
  stage: string,
  userId: string,
  nowMs = Date.now(),
): void {
  const existing = activeTurns.get(correlationId);
  activeTurns.set(correlationId, {
    correlationId,
    userId,
    stage,
    startedAtMs: existing?.startedAtMs ?? nowMs,
    updatedAtMs: nowMs,
  });
}

export async function clearOrchestratorStage(correlationId: string, userId: string): Promise<void> {
  const existing = activeTurns.get(correlationId);
  activeTurns.delete(correlationId);
  try {
    const container = getContainer(SESSIONS_CONTAINER);
    await withTimeout(container.item(makeStageDocId(correlationId), userId).delete(), STAGE_IO_TIMEOUT_MS);
  } catch (err) {
    try {
      const container = getContainer(SESSIONS_CONTAINER);
      await withTimeout(
        container.items.upsert(
          buildClearedStageDocument(
            correlationId,
            userId,
            Date.now(),
            existing?.startedAtMs,
          ),
        ),
        STAGE_IO_TIMEOUT_MS,
      );
    } catch {
      // Best-effort only.
    }
    console.warn(
      `[orchestratorStageHealth] Failed to delete stage doc for correlationId=${correlationId}; wrote cleared tombstone fallback if possible: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export async function getOrchestratorStageSnapshot(nowMs = Date.now()): Promise<{
  activeTurns: number;
  oldestAgeMs: number | null;
  turns: Array<{
    correlationId: string;
    userId: string;
    stage: string;
    ageMs: number;
    updatedAt: string;
  }>;
}> {
  try {
    const container = getContainer(SESSIONS_CONTAINER);
    const { resources } = await withTimeout(container.items
      .query<OrchestratorStageDocument>({
        query: 'SELECT * FROM c WHERE c.type = @type',
        parameters: [{ name: '@type', value: 'orchestrator-stage' }],
      })
      .fetchAll(), STAGE_IO_TIMEOUT_MS);

    const turns = mergeFreshStageEntries(resources, Array.from(activeTurns.values()), nowMs)
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
  } catch {
    const turns = Array.from(activeTurns.values())
      .filter((entry) => isStageEntryFresh(entry, nowMs) && isVisibleStage(entry))
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
}

export function resetOrchestratorStageHealth(): void {
  activeTurns.clear();
}