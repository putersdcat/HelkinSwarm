import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'node:crypto';
import { getEnvConfig } from '../config/envConfig.js';
import { getContainer, getDatabase } from '../memory/cosmosClient.js';
import { APP_VERSION } from '../config/version.js';
import { getMessagePathSnapshot } from '../observability/messagePathHealth.js';
import { getLlmAggregateHealth, getLlmHealthSnapshot } from '../llm/llmHealthTracker.js';
import { getOrchestratorStageSnapshot } from '../observability/orchestratorStageHealth.js';
import { getPendingAckSnapshot } from '../bot/conversationStore.js';
import { STALE_ACK_THRESHOLD_MS } from '../bot/staleAckRecovery.js';
import { getContainerAgeMs } from '../bot/lifecycleNotices.js';

const POST_START_MESSAGE_READINESS_GRACE_MS = 15 * 60_000;
const POST_IDLE_MESSAGE_READINESS_GAP_MS = 10 * 60_000;

interface SwarmAuditSnapshot {
  recentExecutions: number;
  lastPersistedAt: string | null;
  lastSuccessfulPersistedAt: string | null;
  lastFailedPersistedAt: string | null;
  lastPersistenceMode: 'full' | 'compact-fallback' | null;
  // [#706] Count of swarm-execution docs whose status is still 'running'
  // beyond STALE_RUNNING_THRESHOLD_MS — these are running placeholders whose
  // final-persist never landed (orchestrator died, sendReplyActivity hung, or
  // the silent-drop in #706 ate the synthesis turn). Distinct from
  // lastFailedPersistedAt, which is now restricted to docs with status='fail'.
  staleRunningCount: number;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  correlationId: string;
  version: string;
  components: {
    runtime: 'ok' | 'error';
    overseer: 'ok' | 'pending';
    llm: 'ok' | 'degraded' | 'down';
    memory: 'ok' | 'error';
    messagePath: 'ok' | 'degraded' | 'error';
    safetyMode: string;
    euResidencyMode: boolean;
  };
  diagnostics?: {
    llm: {
      aggregate: 'ok' | 'degraded' | 'down';
      models: Array<{
        deploymentName: string;
        lastSuccessAt: string | null;
        lastFailureAt: string | null;
        consecutiveFailures: number;
        isDown: boolean;
      }>;
    };
    orchestrator: {
      activeTurns: number;
      oldestAgeMs: number | null;
      turns: Array<{
        correlationId: string;
        userId?: string;
        stage: string;
        ageMs: number;
        updatedAt: string;
      }>;
    };
    messagePath: {
      pendingTurns: number;
      oldestPendingAgeMs: number | null;
      lastAcceptedAt: string | null;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastFailureReason: string | null;
      pendingAcks: number;
      oldestPendingAckAgeMs: number | null;
      stalePendingAcks: number;
      oldestStalePendingAckAgeMs: number | null;
    };
    swarmAudit: SwarmAuditSnapshot;
  };
}

// Cached memory status with 60s TTL to avoid hitting Cosmos on every health check
let cachedMemoryStatus: 'ok' | 'error' = 'error';
let memoryCheckTimestamp = 0;
const MEMORY_CHECK_TTL_MS = 60_000;

async function checkMemoryStatus(): Promise<'ok' | 'error'> {
  const now = Date.now();
  if (now - memoryCheckTimestamp < MEMORY_CHECK_TTL_MS) {
    return cachedMemoryStatus;
  }
  try {
    const env = getEnvConfig();
    if (!env.cosmosEndpoint) {
      cachedMemoryStatus = 'error';
    } else {
      await getDatabase().read();
      cachedMemoryStatus = 'ok';
    }
  } catch {
    cachedMemoryStatus = 'error';
  }
  memoryCheckTimestamp = now;
  return cachedMemoryStatus;
}

// [#706] A running placeholder is written before the swarm executes; the
// final persist overwrites the same id with the actual result. If the
// orchestrator dies (or sendReplyActivity silent-drops) between the two
// writes, the doc stays at status='running' forever. Treat anything older
// than this threshold as a stale-running placeholder — i.e. evidence of a
// downstream silent failure, NOT a real swarm failure.
const STALE_RUNNING_THRESHOLD_MS = 5 * 60_000;

type SwarmAuditRow = {
  executedAt?: string;
  success?: boolean;
  status?: 'running' | 'ok' | 'fail';
  persistenceMode?: 'full' | 'compact-fallback';
};

async function getSwarmAuditSnapshot(): Promise<SwarmAuditSnapshot> {
  try {
    const container = getContainer('sessions');
    const { resources } = await container.items.query({
      query: `SELECT TOP 10 c.executedAt, c.success, c.status, c.persistenceMode
              FROM c
              WHERE c.type = @type
              ORDER BY c.executedAt DESC`,
      parameters: [
        { name: '@type', value: 'swarm-execution' },
      ],
    }).fetchAll();

    const rows = resources as SwarmAuditRow[];
    const latest = rows[0];
    // [#706] Filter by status, not success. The running placeholder writes
    // success:false, which previously caused lastFailedPersistedAt to flag
    // every stalled placeholder as if it were a real swarm failure — masking
    // the true silent-drop fingerprint described in #706.
    const lastSuccess = rows.find((entry) => entry.status === 'ok');
    const lastFailure = rows.find((entry) => entry.status === 'fail');

    const nowMs = Date.now();
    const staleRunningCount = rows.reduce((count, entry) => {
      if (entry.status !== 'running' || !entry.executedAt) return count;
      const ageMs = nowMs - Date.parse(entry.executedAt);
      return Number.isFinite(ageMs) && ageMs > STALE_RUNNING_THRESHOLD_MS
        ? count + 1
        : count;
    }, 0);

    return {
      recentExecutions: rows.length,
      lastPersistedAt: latest?.executedAt ?? null,
      lastSuccessfulPersistedAt: lastSuccess?.executedAt ?? null,
      lastFailedPersistedAt: lastFailure?.executedAt ?? null,
      lastPersistenceMode: latest?.persistenceMode ?? null,
      staleRunningCount,
    };
  } catch {
    return {
      recentExecutions: 0,
      lastPersistedAt: null,
      lastSuccessfulPersistedAt: null,
      lastFailedPersistedAt: null,
      lastPersistenceMode: null,
      staleRunningCount: 0,
    };
  }
}

export async function healthHandler(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const nowMs = Date.now();
  const env = getEnvConfig();
  const memoryStatus = await checkMemoryStatus();
  const messagePath = await getMessagePathSnapshot(nowMs);
  const pendingAckSnapshot = await getPendingAckSnapshot(STALE_ACK_THRESHOLD_MS);
  const llmHealth = getLlmAggregateHealth();
  const llmSnapshot = getLlmHealthSnapshot();
  const orchestratorSnapshot = await getOrchestratorStageSnapshot();
  const swarmAuditSnapshot = await getSwarmAuditSnapshot();
  const containerAgeMs = getContainerAgeMs();

  const startupAcceptanceGap =
    containerAgeMs < POST_START_MESSAGE_READINESS_GRACE_MS &&
    messagePath.lastAcceptedAt === null &&
    messagePath.pendingTurns === 0 &&
    pendingAckSnapshot.pendingAcks === 0;

  const lastAcceptedAtMs = messagePath.lastAcceptedAt
    ? new Date(messagePath.lastAcceptedAt).getTime()
    : null;
  const idleAcceptanceGap =
    lastAcceptedAtMs !== null &&
    nowMs - lastAcceptedAtMs >= POST_IDLE_MESSAGE_READINESS_GAP_MS &&
    messagePath.pendingTurns === 0 &&
    pendingAckSnapshot.pendingAcks === 0;

  const effectiveMessagePathStatus: HealthResponse['components']['messagePath'] =
    startupAcceptanceGap && messagePath.status === 'ok'
      ? 'degraded'
      : idleAcceptanceGap && messagePath.status === 'ok'
      ? 'degraded'
      : pendingAckSnapshot.stalePendingAcks > 0 && messagePath.status === 'ok'
      ? 'degraded'
      : messagePath.status;

  const runtimeStatus = effectiveMessagePathStatus === 'error' ? 'error' : 'ok';
  const overallStatus: HealthResponse['status'] =
    runtimeStatus === 'error' || llmHealth === 'down'
      ? 'unhealthy'
      : memoryStatus === 'error' || effectiveMessagePathStatus === 'degraded' || llmHealth === 'degraded'
        ? 'degraded'
        : 'healthy';

  const health: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    correlationId: randomUUID(),
    version: APP_VERSION,
    components: {
      runtime: runtimeStatus,
      overseer: 'ok',
      llm: llmHealth,
      memory: memoryStatus,
      messagePath: effectiveMessagePathStatus,
      safetyMode: env.safetyMode,
      euResidencyMode: env.euResidencyMode,
    },
    diagnostics: {
      llm: llmSnapshot,
      orchestrator: orchestratorSnapshot,
      messagePath: {
        pendingTurns: messagePath.pendingTurns,
        oldestPendingAgeMs: messagePath.oldestPendingAgeMs,
        lastAcceptedAt: messagePath.lastAcceptedAt,
        lastSuccessAt: messagePath.lastSuccessAt,
        lastFailureAt: messagePath.lastFailureAt,
        lastFailureReason: messagePath.lastFailureReason,
        pendingAcks: pendingAckSnapshot.pendingAcks,
        oldestPendingAckAgeMs: pendingAckSnapshot.oldestPendingAgeMs,
        stalePendingAcks: pendingAckSnapshot.stalePendingAcks,
        oldestStalePendingAckAgeMs: pendingAckSnapshot.oldestStalePendingAgeMs,
      },
      swarmAudit: swarmAuditSnapshot,
    },
  };

  return {
    status: 200,
    jsonBody: health,
    headers: { 'Content-Type': 'application/json' },
  };
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: healthHandler,
});
