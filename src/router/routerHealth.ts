import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { randomUUID } from 'node:crypto';
import { getEnvConfig } from '../config/envConfig.js';
import { APP_VERSION } from '../config/version.js';
import { getMessagePathSnapshot } from '../observability/messagePathHealth.js';
import { getUserMapStatus } from './userMapStore.js';

interface RouterHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  correlationId: string;
  version: string;
  components: {
    runtime: 'ok' | 'error';
    routingConfig: 'ok' | 'error';
    messagePath: 'ok' | 'degraded' | 'error';
    safetyMode: string;
    euResidencyMode: boolean;
  };
  diagnostics: {
    routingConfig: {
      totalUsers: number;
      enabledUsers: number;
      error: string | null;
    };
    messagePath: {
      pendingTurns: number;
      oldestPendingAgeMs: number | null;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastFailureReason: string | null;
    };
  };
}

export function deriveRouterOverallStatus(
  runtime: RouterHealthResponse['components']['runtime'],
  routingConfig: RouterHealthResponse['components']['routingConfig'],
  messagePath: RouterHealthResponse['components']['messagePath'],
): RouterHealthResponse['status'] {
  if (runtime === 'error' || messagePath === 'error') {
    return 'unhealthy';
  }
  if (routingConfig === 'error' || messagePath === 'degraded') {
    return 'degraded';
  }
  return 'healthy';
}

export async function routerHealthHandler(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const env = getEnvConfig();
  const messagePath = getMessagePathSnapshot();
  const routingConfig = await getUserMapStatus();

  const runtimeStatus: RouterHealthResponse['components']['runtime'] =
    messagePath.status === 'error' ? 'error' : 'ok';

  const overallStatus = deriveRouterOverallStatus(
    runtimeStatus,
    routingConfig.status,
    messagePath.status,
  );

  const health: RouterHealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    correlationId: randomUUID(),
    version: APP_VERSION,
    components: {
      runtime: runtimeStatus,
      routingConfig: routingConfig.status,
      messagePath: messagePath.status,
      safetyMode: env.safetyMode,
      euResidencyMode: env.euResidencyMode,
    },
    diagnostics: {
      routingConfig: {
        totalUsers: routingConfig.totalUsers,
        enabledUsers: routingConfig.enabledUsers,
        error: routingConfig.error,
      },
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

app.http('router-health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: routerHealthHandler,
});