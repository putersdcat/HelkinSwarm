import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'node:crypto';
import { getEnvConfig } from '../config/envConfig.js';
import { getDatabase } from '../memory/cosmosClient.js';
import { APP_VERSION } from '../config/version.js';
import { getMessagePathSnapshot } from '../observability/messagePathHealth.js';
import { getLlmAggregateHealth } from '../llm/llmHealthTracker.js';

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
    messagePath: {
      pendingTurns: number;
      oldestPendingAgeMs: number | null;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastFailureReason: string | null;
    };
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

export async function healthHandler(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const env = getEnvConfig();
  const memoryStatus = await checkMemoryStatus();
  const messagePath = await getMessagePathSnapshot();
  const llmHealth = getLlmAggregateHealth();

  const runtimeStatus = messagePath.status === 'error' ? 'error' : 'ok';
  const overallStatus: HealthResponse['status'] =
    runtimeStatus === 'error' || llmHealth === 'down'
      ? 'unhealthy'
      : memoryStatus === 'error' || messagePath.status === 'degraded' || llmHealth === 'degraded'
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
      messagePath: messagePath.status,
      safetyMode: env.safetyMode,
      euResidencyMode: env.euResidencyMode,
    },
    diagnostics: {
      messagePath: {
        pendingTurns: messagePath.pendingTurns,
        oldestPendingAgeMs: messagePath.oldestPendingAgeMs,
        lastSuccessAt: messagePath.lastSuccessAt,
        lastFailureAt: messagePath.lastFailureAt,
        lastFailureReason: messagePath.lastFailureReason,
      },
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
