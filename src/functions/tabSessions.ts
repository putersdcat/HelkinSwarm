// Tab Sessions backend — returns running orchestration sessions with status and metadata.
// Owner-only endpoint for the Dev Console tab panel.
// Spec ref: docs/ADDENDA/ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md
// Issue: #141, #86

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import { isOwnerUserId } from '../bot/maintenanceMode.js';

app.http('tab-sessions', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'tab/sessions',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const client = df.getClient(context);
    const statuses = await client.getStatusAll();

    const sessions = statuses.map((s) => ({
      instanceId: s.instanceId,
      name: s.name,
      runtimeStatus: s.runtimeStatus,
      createdAt: s.createdTime?.toISOString() ?? null,
      lastUpdated: s.lastUpdatedTime?.toISOString() ?? null,
      isRunning: s.runtimeStatus === OrchestrationRuntimeStatus.Running ||
                 s.runtimeStatus === OrchestrationRuntimeStatus.Pending ||
                 s.runtimeStatus === OrchestrationRuntimeStatus.ContinuedAsNew,
    }));

    // Sort running sessions first, then by creation time descending
    sessions.sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      const aTime = a.createdAt ?? '';
      const bTime = b.createdAt ?? '';
      return bTime.localeCompare(aTime);
    });

    return {
      status: 200,
      jsonBody: {
        sessions,
        total: sessions.length,
        active: sessions.filter((s) => s.isRunning).length,
      },
    };
  },
});
