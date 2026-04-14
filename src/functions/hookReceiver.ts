// Hook Receiver — HTTP trigger that receives external hook fire events.
// External systems (Graph subscriptions, webhooks, timers) POST here to fire a hook.
// The receiver validates the hook, records the firing, and raises a Durable external event.
// Spec ref: ADDENDA-08 §2.5

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { z } from 'zod';
import { getEnvConfig } from '../config/envConfig.js';
import { getHookById, recordHookFired } from '../orchestrator/hookCatalog.js';
import { resolveDeliverableOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';
import { recordLimbicIngressDecision } from '../orchestrator/limbicIngressActivity.js';
import { getConversationReference } from '../bot/conversationStore.js';
import { signalMindSessionAcquire } from '../orchestrator/mindSessionGuard.js';
import type { NewMessageEvent } from '../orchestrator/overseer.js';
import { trackEvent } from '../observability/telemetry.js';

function isStartConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('409') || message.includes('already exists') || message.includes('conflict');
}

const HookReceiverPayloadSchema = z.object({
  hookId: z.string().uuid(),
  userId: z.string(),
  payload: z.record(z.unknown()).default({}),
  triggerType: z.string().optional(),
});

app.http('hookReceiver', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'hooks/fire',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    let body: z.infer<typeof HookReceiverPayloadSchema>;
    try {
      body = HookReceiverPayloadSchema.parse(await req.json());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid payload. Required: hookId (uuid), userId.' } };
    }

    const hook = await getHookById(body.hookId, body.userId);
    if (!hook) {
      return { status: 404, jsonBody: { error: 'Hook not found.' } };
    }
    if (hook.status !== 'active') {
      return { status: 409, jsonBody: { error: `Hook is ${hook.status}, not active.` } };
    }

    // Check expiration
    if (new Date(hook.expiresAt) <= new Date()) {
      return { status: 410, jsonBody: { error: 'Hook has expired.' } };
    }

    // Record the firing
    await recordHookFired(body.hookId, body.userId);

    // Raise external event to resume the user's overseer orchestration.
    // Use the deliverable resolver so guard-owned and dedup-hold sessions remain reachable.
    const client = df.getClient(context);
    const firedPayload = {
      hookId: body.hookId,
      userId: body.userId,
      correlationId: hook.correlationId,
      hookType: hook.hookType,
      originalIntent: hook.originalIntent,
      payload: body.payload,
      triggerType: body.triggerType ?? hook.triggerConfig.type,
      firedAt: new Date().toISOString(),
    };

    const activeOverseerInstanceId = await resolveDeliverableOverseerInstanceId(client, body.userId);

    if (!activeOverseerInstanceId) {
      // Self-wake path: no living session → attempt to start one with the hook's original intent.
      // Aligns with the Chrono-Backplane/Limbic model (0z/0za: self-awakening).
      recordLimbicIngressDecision({
        source: 'hook-fired',
        userId: body.userId,
        correlationId: hook.correlationId,
        compatibilityMode: getEnvConfig().livingMindCompatibilityMode,
        hasActiveSession: false,
      });

      const conversationReference = await getConversationReference(body.userId);
      if (!conversationReference) {
        context.warn(`[hookReceiver] No active session and no conversation reference for userId=${body.userId}; hook firing recorded only`);
        return {
          status: 202,
          jsonBody: { accepted: true, hookId: body.hookId, deliveredToOverseer: false },
        };
      }

      const wakeInstanceId = `overseer-${body.userId}-hook-${body.hookId.slice(0, 8)}`;
      const wakeEvent: NewMessageEvent = {
        userMessage: hook.originalIntent,
        conversationReference,
        userId: body.userId,
        userAlias: body.userId.slice(0, 4),
        correlationId: hook.correlationId,
      };

      try {
        await client.startNew('overseer', { instanceId: wakeInstanceId, input: wakeEvent });
      } catch (startErr: unknown) {
        if (!isStartConflict(startErr)) {
          context.warn(`[hookReceiver] Failed to wake overseer for hookId=${body.hookId}, userId=${body.userId}`, startErr);
          return {
            status: 202,
            jsonBody: { accepted: true, hookId: body.hookId, deliveredToOverseer: false },
          };
        }
        // 409 race condition — session being created concurrently; still signal guard
      }

      await signalMindSessionAcquire(client, body.userId, {
        instanceId: wakeInstanceId,
        correlationId: hook.correlationId,
        source: 'hook-fired-wake',
      });

      trackEvent({
        name: 'DurableHookTriggered',
        correlationId: hook.correlationId,
        userId: body.userId,
        properties: {
          source: 'hook-fired',
          hookId: body.hookId,
          hookType: hook.hookType,
          deliveredToOverseer: true,
          woke: 'true',
          instanceId: wakeInstanceId,
        },
      });

      context.log(`[hookReceiver] Hook fired (self-wake): hookId=${body.hookId} userId=${body.userId} type=${hook.hookType} instanceId=${wakeInstanceId}`);
      return {
        status: 202,
        jsonBody: { accepted: true, hookId: body.hookId, deliveredToOverseer: true, woke: true, instanceId: wakeInstanceId },
      };
    }

    recordLimbicIngressDecision({
      source: 'hook-fired',
      userId: body.userId,
      correlationId: hook.correlationId,
      compatibilityMode: getEnvConfig().livingMindCompatibilityMode,
      hasActiveSession: true,
    });

    try {
      await client.raiseEvent(activeOverseerInstanceId, 'HookFired', firedPayload);
    } catch (raiseErr) {
      context.warn(`[hookReceiver] Failed to raise event for hookId=${body.hookId}, userId=${body.userId}, instanceId=${activeOverseerInstanceId}`, raiseErr);
      // Still return 202 — the hook was fired and recorded even if overseer is not running
    }

    trackEvent({
      name: 'DurableHookTriggered',
      correlationId: hook.correlationId,
      userId: body.userId,
      properties: {
        source: 'hook-fired',
        hookId: body.hookId,
        hookType: hook.hookType,
        deliveredToOverseer: true,
        instanceId: activeOverseerInstanceId,
      },
    });

    context.log(`[hookReceiver] Hook fired: hookId=${body.hookId} userId=${body.userId} type=${hook.hookType}`);
    return {
      status: 202,
      jsonBody: { accepted: true, hookId: body.hookId, deliveredToOverseer: true, instanceId: activeOverseerInstanceId },
    };
  },
});
