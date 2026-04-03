// Emergency stop / resume HTTP triggers.
// Protected with Function auth level and owner userId check.
// Spec ref: 04-Safety-Architecture.md, 10-Teams-Interface.md

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import { isOwnerUserId, setMaintenanceMode } from '../bot/maintenanceMode.js';
import { clearOrchestratorStagesForInstanceIds } from '../observability/orchestratorStageHealth.js';
import { pauseAllHooksForUser } from '../orchestrator/hookCatalog.js';

async function readUserId(req: HttpRequest): Promise<string | null> {
  const headerUserId = req.headers.get('x-helkinswarm-user-id');
  if (headerUserId) return headerUserId;

  try {
    const body = (await req.json()) as { userId?: string };
    return body.userId ?? null;
  } catch {
    return null;
  }
}

async function terminateAllOrchestrations(client: df.DurableClient): Promise<number> {
  const statuses = await client.getStatusAll();
  const activeStatuses = new Set<OrchestrationRuntimeStatus>([
    OrchestrationRuntimeStatus.Running,
    OrchestrationRuntimeStatus.Pending,
    OrchestrationRuntimeStatus.ContinuedAsNew,
  ]);

  const targets = statuses.filter(
    (status) =>
      status.instanceId &&
      status.runtimeStatus &&
      activeStatuses.has(status.runtimeStatus),
  );

  await Promise.all(
    targets.map((status) =>
      client.terminate(status.instanceId, 'Emergency stop invoked via HTTP endpoint'),
    ),
  );

  await clearOrchestratorStagesForInstanceIds(
    targets.map((status) => status.instanceId),
  );

  return targets.length;
}

app.http('emergency-stop', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'emergency-stop',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const userId = await readUserId(req);
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const client = df.getClient(context);
    const terminated = await terminateAllOrchestrations(client);

    // Pause all active durable hooks for the user (#72)
    let hooksPaused = 0;
    try {
      hooksPaused = await pauseAllHooksForUser(userId);
    } catch (hookErr) {
      context.error(`[EmergencyStop] Failed to pause hooks for userId=${userId}`, hookErr);
    }

    await setMaintenanceMode({
      enabled: true,
      updatedBy: userId,
      source: 'emergency-stop',
      reason: 'Emergency stop invoked via HTTP endpoint',
    });

    context.error(`[EmergencyStop] P0 event: maintenance enabled by userId=${userId}; terminated=${terminated}; hooksPaused=${hooksPaused}`);
    return {
      status: 200,
      jsonBody: {
        ok: true,
        maintenanceMode: true,
        terminated,
        hooksPaused,
      },
    };
  },
});

app.http('emergency-resume', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'emergency-resume',
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const userId = await readUserId(req);
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    await setMaintenanceMode({
      enabled: false,
      updatedBy: userId,
      reason: 'Emergency resume invoked via HTTP endpoint',
    });

    context.error(`[EmergencyStop] P0 event: maintenance cleared by userId=${userId}`);
    return {
      status: 200,
      jsonBody: {
        ok: true,
        maintenanceMode: false,
      },
    };
  },
});
