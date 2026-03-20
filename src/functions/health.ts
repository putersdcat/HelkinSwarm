import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomUUID } from 'node:crypto';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  correlationId: string;
  version: string;
  components: {
    runtime: 'ok' | 'error';
    overseer: 'ok' | 'pending';
    llm: 'ok' | 'pending';
    memory: 'ok' | 'pending';
    safetyMode: string;
    euResidencyMode: boolean;
  };
}

export async function healthHandler(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const euMode = process.env['EU_RESIDENCY_MODE'] === 'true';
  const safetyMode = process.env['SAFETY_MODE'] ?? 'confirmation-gated';

  const health: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    correlationId: randomUUID(),
    version: process.env['npm_package_version'] ?? '0.1.0',
    components: {
      runtime: 'ok',
      overseer: 'ok',
      llm: 'ok',
      memory: 'pending',
      safetyMode,
      euResidencyMode: euMode,
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
