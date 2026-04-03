// Graph Notification Handler — receives change notifications from Microsoft Graph subscriptions.
// Handles the validation handshake (validationToken) and routes notifications to durable hooks.
// Spec ref: 0h-Long-Running-Workflows.md §3, Issue #73
//
// Graph sends a POST with either:
//   1. A validation token (subscription creation handshake) — return it as text/plain
//   2. One or more change notifications — route each to the corresponding hook

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { z } from 'zod';
import { getHookById, recordHookFired } from '../orchestrator/hookCatalog.js';
import { resolveActiveOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Zod schemas for Graph notification payloads
// ---------------------------------------------------------------------------

const GraphNotificationSchema = z.object({
  subscriptionId: z.string(),
  changeType: z.string(),
  resource: z.string(),
  clientState: z.string().optional(),
  resourceData: z.record(z.unknown()).optional(),
  subscriptionExpirationDateTime: z.string().optional(),
});

const GraphNotificationPayloadSchema = z.object({
  value: z.array(GraphNotificationSchema),
});

// ---------------------------------------------------------------------------
// Client state format: "hookId:userId" — securely links notification to hook
// ---------------------------------------------------------------------------

function parseClientState(clientState: string): { hookId: string; userId: string } | undefined {
  const parts = clientState.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { hookId: parts[0], userId: parts[1] };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

app.http('graphNotificationHandler', {
  methods: ['POST'],
  authLevel: 'anonymous', // Graph sends notifications without auth headers
  route: 'hooks/graph-notify',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    // ── Step 1: Validation handshake ──────────────────────────────────────
    const validationToken = req.query.get('validationToken');
    if (validationToken) {
      context.log('[graphNotify] Subscription validation handshake');
      return {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: validationToken,
      };
    }

    // ── Step 2: Parse notification payload ────────────────────────────────
    let payload: z.infer<typeof GraphNotificationPayloadSchema>;
    try {
      payload = GraphNotificationPayloadSchema.parse(await req.json());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid Graph notification payload.' } };
    }

    const client = df.getClient(context);
    let processed = 0;

    for (const notification of payload.value) {
      // ── Step 3: Validate client state ─────────────────────────────────
      if (!notification.clientState) {
        context.warn('[graphNotify] Notification without clientState, skipping');
        continue;
      }

      const parsed = parseClientState(notification.clientState);
      if (!parsed) {
        context.warn(`[graphNotify] Invalid clientState format: ${notification.clientState}`);
        continue;
      }

      const { hookId, userId } = parsed;

      // ── Step 4: Look up and validate hook ─────────────────────────────
      const hook = await getHookById(hookId, userId);
      if (!hook) {
        context.warn(`[graphNotify] Hook not found: hookId=${hookId} userId=${userId}`);
        continue;
      }
      if (hook.status !== 'active') {
        context.warn(`[graphNotify] Hook ${hookId} is ${hook.status}, skipping`);
        continue;
      }
      if (new Date(hook.expiresAt) <= new Date()) {
        context.warn(`[graphNotify] Hook ${hookId} has expired, skipping`);
        continue;
      }

      // ── Step 5: Record firing and raise event ─────────────────────────
      await recordHookFired(hookId, userId);

      const firedPayload = {
        hookId,
        userId,
        correlationId: hook.correlationId,
        hookType: hook.hookType,
        originalIntent: hook.originalIntent,
        subscriptionId: notification.subscriptionId,
        changeType: notification.changeType,
        resource: notification.resource,
        resourceData: notification.resourceData ?? {},
        triggerType: 'graphSubscription',
        firedAt: new Date().toISOString(),
      };

      const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, userId);

      if (!activeOverseerInstanceId) {
        context.warn(`[graphNotify] No active overseer instance found for hookId=${hookId} userId=${userId}; notification recorded only`);
      } else {
        try {
          await client.raiseEvent(activeOverseerInstanceId, 'HookFired', firedPayload);
        } catch (raiseErr) {
          context.warn(`[graphNotify] Failed to raise event for hookId=${hookId} instanceId=${activeOverseerInstanceId}`, raiseErr);
        }
      }

      trackEvent({
        name: 'GraphNotificationProcessed',
        correlationId: hook.correlationId,
        userId,
        properties: {
          hookId,
          subscriptionId: notification.subscriptionId,
          changeType: notification.changeType,
          resource: notification.resource,
          deliveredToOverseer: activeOverseerInstanceId !== undefined,
        },
      });

      processed++;
    }

    context.log(`[graphNotify] Processed ${processed}/${payload.value.length} notifications`);

    // Graph expects 202 to confirm receipt
    return {
      status: 202,
      jsonBody: { accepted: true, processed },
    };
  },
});
