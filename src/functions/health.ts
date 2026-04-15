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

async function getSwarmAuditSnapshot(): Promise<SwarmAuditSnapshot> {
  try {
    const container = getContainer('sessions');
    const { resources } = await container.items.query({
      query: `SELECT TOP 10 c.executedAt, c.success, c.persistenceMode
              FROM c
              WHERE c.type = @type
              ORDER BY c.executedAt DESC`,
      parameters: [
        { name: '@type', value: 'swarm-execution' },
      ],
    }).fetchAll();

    const latest = resources[0] as {
      executedAt?: string;
      success?: boolean;
      persistenceMode?: 'full' | 'compact-fallback';
    } | undefined;
    const lastSuccess = resources.find((entry) => entry.success === true) as { executedAt?: string } | undefined;
    const lastFailure = resources.find((entry) => entry.success === false) as { executedAt?: string } | undefined;

    return {
      recentExecutions: resources.length,
      lastPersistedAt: latest?.executedAt ?? null,
      lastSuccessfulPersistedAt: lastSuccess?.executedAt ?? null,
      lastFailedPersistedAt: lastFailure?.executedAt ?? null,
      lastPersistenceMode: latest?.persistenceMode ?? null,
    };
  } catch {
    return {
      recentExecutions: 0,
      lastPersistedAt: null,
      lastSuccessfulPersistedAt: null,
      lastFailedPersistedAt: null,
      lastPersistenceMode: null,
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
