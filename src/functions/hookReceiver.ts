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
import { getHookById, recordHookFired } from '../orchestrator/hookCatalog.js';
import { resolveActiveOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';

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

    // Raise external event to resume the user's overseer orchestration
    const client = df.getClient(context);
    const firedPayload = {
      hookId: body.hookId,
      payload: body.payload,
      triggerType: body.triggerType ?? hook.triggerConfig.type,
      firedAt: new Date().toISOString(),
    };

    const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, body.userId);

    if (!activeOverseerInstanceId) {
      context.warn(`[hookReceiver] No active overseer instance found for userId=${body.userId}; hook firing recorded only`);
      return {
        status: 202,
        jsonBody: { accepted: true, hookId: body.hookId, deliveredToOverseer: false },
      };
    }

    try {
      await client.raiseEvent(activeOverseerInstanceId, `HookFired_${body.hookId}`, firedPayload);
    } catch (raiseErr) {
      context.warn(`[hookReceiver] Failed to raise event for hookId=${body.hookId}, userId=${body.userId}, instanceId=${activeOverseerInstanceId}`, raiseErr);
      // Still return 202 — the hook was fired and recorded even if overseer is not running
    }

    context.log(`[hookReceiver] Hook fired: hookId=${body.hookId} userId=${body.userId} type=${hook.hookType}`);
    return {
      status: 202,
      jsonBody: { accepted: true, hookId: body.hookId, deliveredToOverseer: true, instanceId: activeOverseerInstanceId },
    };
  },
});
