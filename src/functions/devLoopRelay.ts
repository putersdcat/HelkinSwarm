// DevLoop Relay HTTP endpoints — push (DevLoop→Runtime) and pull (Runtime→DevLoop).
// Spec ref: ADDENDA-08 §3.3-3.4, 0g-Bidirectional-Communication-Evolution.md

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import { z } from 'zod';
import { isOwnerUserId } from '../bot/maintenanceMode.js';
import { getConversationReference } from '../bot/conversationStore.js';
import { getEnvConfig } from '../config/envConfig.js';
import {
  writeRelayMessage,
  pollOutboundMessages,
  markDelivered,
  getMessagesByCorrelation,
} from '../devloop/relayStore.js';
import { ResurrectionCommandSchema } from '../devloop/radioProtocol.js';
import type { NewMessageEvent } from '../orchestrator/overseer.js';
import { resolveActiveOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';
import { recordLimbicIngressDecision } from '../orchestrator/limbicIngressActivity.js';
import { registerHook } from '../orchestrator/hookCatalog.js';
import { signalMindSessionAcquire } from '../orchestrator/mindSessionGuard.js';
import {
  clearOrchestratorStage,
  getActiveTurnCountForUser,
  recordOrchestratorStage,
} from '../observability/orchestratorStageHealth.js';
import { saveChronoScheduledWake } from '../orchestrator/chronoBackplane.js';
import { trackEvent } from '../observability/telemetry.js';
import { getTraceTree, findTraceTreeByShortCorrelation } from '../observability/sessionTracer.js';

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const PushPayloadSchema = z.object({
  correlationTag: z.string(),
  messageType: z.enum(['DEVQUERY', 'DEVLOOP', 'HEARTBEAT', 'SWARM-TOOL-REPORT']),
  payload: z.record(z.unknown()).default({}),
});

const AckPayloadSchema = z.object({
  messageIds: z.array(z.object({
    id: z.string(),
    correlationTag: z.string(),
  })),
});

const ActiveTurnProofPayloadSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('seed'),
    count: z.number().int().min(1).max(10),
    correlationPrefix: z.string().min(3).max(80).optional(),
    stage: z.string().min(1).max(80).default('synthetic-active-turn'),
  }),
  z.object({
    action: z.literal('clear'),
    correlationIds: z.array(z.string().min(1)).min(1).max(20),
  }),
]);

const SelfAwakenPayloadSchema = z.object({
  message: z.string().min(1).max(400),
  delaySeconds: z.number().int().min(1).max(600).default(70),
});

const InjectNewMessagePayloadSchema = z.object({
  message: z.string().min(1).max(400),
  correlationPrefix: z.string().min(3).max(80).default('devloop-injected'),
  instanceIdOverride: z.string().min(1).optional(),
});

const RegisterHookProofPayloadSchema = z.object({
  targetUserId: z.string().min(1).optional(),
  originalIntent: z.string().min(1).max(400).default('Say exactly "hook proof ok" and nothing else.'),
  ttlMinutes: z.number().int().min(1).max(30).default(10),
});

// ---------------------------------------------------------------------------
// POST /api/devloop/push — DevLoop sends a message to the runtime
// ---------------------------------------------------------------------------

app.http('devloopPush', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/push',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof PushPayloadSchema>;
    try {
      body = PushPayloadSchema.parse(await req.json());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid payload. Required: correlationTag, messageType.' } };
    }

    const doc = await writeRelayMessage({
      correlationTag: body.correlationTag,
      direction: 'inbound',
      sender: 'devloop',
      messageType: body.messageType,
      payload: body.payload,
    });

    // Raise durable event to wake the overseer if it's listening for DevLoop messages
    const client = df.getClient(context);
    const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, userId);
    if (activeOverseerInstanceId) {
      try {
        await client.raiseEvent(activeOverseerInstanceId, 'DevLoopMessage', {
          messageId: doc.id,
          correlationTag: doc.correlationTag,
          messageType: doc.messageType,
        });
      } catch {
        // Overseer may no longer be running — message is persisted in Cosmos regardless
      }
    }

    context.log(`[devloopRelay] Push: type=${doc.messageType} corr=${doc.correlationTag}`);
    trackEvent({
      name: 'DevLoopRelayPush',
      correlationId: doc.correlationTag,
      userId,
      properties: {
        messageType: doc.messageType,
        messageId: doc.id,
        deliveredToOverseer: activeOverseerInstanceId !== undefined,
        instanceId: activeOverseerInstanceId ?? 'none',
      },
    });
    return {
      status: 202,
      jsonBody: {
        messageId: doc.id,
        correlationTag: doc.correlationTag,
        deliveredToOverseer: activeOverseerInstanceId !== undefined,
        instanceId: activeOverseerInstanceId ?? null,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// GET /api/devloop/poll — DevLoop polls for outbound messages from runtime
// ---------------------------------------------------------------------------

app.http('devloopPoll', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'devloop/poll',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const since = req.query.get('since') ?? new Date(Date.now() - 60 * 1000).toISOString();
    const limit = Math.min(parseInt(req.query.get('limit') ?? '50', 10), 100);

    const messages = await pollOutboundMessages(since, limit);
    if (messages.length > 0) {
      trackEvent({
        name: 'DevLoopRelayPoll',
        correlationId: messages[0].correlationTag,
        userId,
        properties: { count: messages.length },
      });
    }
    return {
      status: 200,
      jsonBody: { messages, count: messages.length },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/devloop/ack — DevLoop acknowledges message delivery
// ---------------------------------------------------------------------------

app.http('devloopAck', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/ack',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof AckPayloadSchema>;
    try {
      body = AckPayloadSchema.parse(await req.json());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid payload. Required: messageIds[{id, correlationTag}].' } };
    }

    let acknowledged = 0;
    for (const msg of body.messageIds) {
      try {
        await markDelivered(msg.id, msg.correlationTag);
        acknowledged++;
      } catch {
        // Message may have been deleted or already delivered
      }
    }

    return { status: 200, jsonBody: { acknowledged } };
  },
});

// ---------------------------------------------------------------------------
// GET /api/devloop/thread/{correlationTag} — Get all messages for a correlation
// ---------------------------------------------------------------------------

app.http('devloopThread', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'devloop/thread/{correlationTag}',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const correlationTag = req.params.correlationTag;
    if (!correlationTag) {
      return { status: 400, jsonBody: { error: 'Missing correlationTag parameter.' } };
    }

    const messages = await getMessagesByCorrelation(correlationTag);
    return {
      status: 200,
      jsonBody: { correlationTag, messages, count: messages.length },
    };
  },
});

// ---------------------------------------------------------------------------
// GET /api/devloop/session-bundle/{correlationTag} — joined runtime trace bundle
// ---------------------------------------------------------------------------

app.http('devloopSessionBundle', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'devloop/session-bundle/{correlationTag}',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const correlationTag = req.params.correlationTag;
    if (!correlationTag) {
      return { status: 400, jsonBody: { error: 'Missing correlationTag parameter.' } };
    }

    const messages = await getMessagesByCorrelation(correlationTag);
    const exactTraceTree = getTraceTree(correlationTag);
    const shortTraceTree = exactTraceTree ?? findTraceTreeByShortCorrelation(correlationTag);
    const traceTree = shortTraceTree ?? null;
    const traceLookupMode = exactTraceTree
      ? 'exact'
      : shortTraceTree
        ? 'short-prefix'
        : 'miss';

    trackEvent({
      name: 'DevLoopRelayPoll',
      correlationId: correlationTag,
      userId,
      properties: {
        endpoint: 'session-bundle',
        relayMessageCount: messages.length,
        traceTreePresent: traceTree !== null,
        traceLookupMode,
      },
    });

    return {
      status: 200,
      jsonBody: {
        correlationTag,
        relayMessages: messages,
        relayMessageCount: messages.length,
        traceLookupMode,
        traceTree,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/devloop/active-turns — seed/clear synthetic active-turn docs for proof
// ---------------------------------------------------------------------------

app.http('devloopActiveTurns', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/active-turns',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof ActiveTurnProofPayloadSchema>;
    try {
      body = ActiveTurnProofPayloadSchema.parse(await req.json());
    } catch {
      return {
        status: 400,
        jsonBody: {
          error: 'Invalid payload. Required action=seed|clear. Seed requires count; clear requires correlationIds.',
        },
      };
    }

    if (body.action === 'seed') {
      const prefix = body.correlationPrefix ?? `synthetic-${Date.now()}`;
      const correlationIds = Array.from({ length: body.count }, (_, index) => `${prefix}-${index + 1}`);

      for (const correlationId of correlationIds) {
        await recordOrchestratorStage(correlationId, body.stage, userId);
      }

      const activeTurnCount = await getActiveTurnCountForUser(userId);
      trackEvent({
        name: 'DevLoopRelayPush',
        correlationId: correlationIds[0] ?? prefix,
        userId,
        properties: {
          endpoint: 'active-turns',
          action: body.action,
          count: body.count,
          activeTurnCount,
        },
      });

      return {
        status: 200,
        jsonBody: {
          action: body.action,
          correlationIds,
          activeTurnCount,
        },
      };
    }

    for (const correlationId of body.correlationIds) {
      await clearOrchestratorStage(correlationId, userId);
    }

    const activeTurnCount = await getActiveTurnCountForUser(userId);
    trackEvent({
      name: 'DevLoopRelayPush',
      correlationId: body.correlationIds[0],
      userId,
      properties: {
        endpoint: 'active-turns',
        action: body.action,
        count: body.correlationIds.length,
        activeTurnCount,
      },
    });

    return {
      status: 200,
      jsonBody: {
        action: body.action,
        cleared: body.correlationIds.length,
        activeTurnCount,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/devloop/self-awaken — register a chrono-backed wake for proof
// ---------------------------------------------------------------------------

app.http('devloopSelfAwaken', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/self-awaken',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof SelfAwakenPayloadSchema>;
    try {
      body = SelfAwakenPayloadSchema.parse(await req.json());
    } catch {
      return {
        status: 400,
        jsonBody: { error: 'Invalid payload. Required: message, optional delaySeconds.' },
      };
    }

    const conversationReference = await getConversationReference(userId);
    if (!conversationReference) {
      return {
        status: 409,
        jsonBody: { error: 'No conversation reference available for owner user yet.' },
      };
    }

    const wakeAt = new Date(Date.now() + body.delaySeconds * 1000).toISOString();
    const registrationCorrelationId = `register-self-awaken-${Date.now()}`;
    const wake = await saveChronoScheduledWake({
      userId,
      wakeAt,
      wakeMessage: body.message,
      registrationCorrelationId,
      conversationReferenceJson: JSON.stringify(conversationReference),
    });

    trackEvent({
      name: 'ChronoScheduledWakeRegistered',
      correlationId: registrationCorrelationId,
      userId,
      properties: {
        wakeId: wake.id,
        wakeAt,
      },
    });

    return {
      status: 200,
      jsonBody: {
        wakeId: wake.id,
        wakeAt,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/devloop/register-hook-proof — register a synthetic webhook hook
// ---------------------------------------------------------------------------

app.http('devloopRegisterHookProof', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/register-hook-proof',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof RegisterHookProofPayloadSchema>;
    try {
      body = RegisterHookProofPayloadSchema.parse(await req.json());
    } catch {
      return {
        status: 400,
        jsonBody: { error: 'Invalid payload. Optional: targetUserId, originalIntent, ttlMinutes.' },
      };
    }

    const targetUserId = body.targetUserId ?? userId;
    const correlationId = `register-hook-proof-${Date.now()}`;
    const registered = await registerHook({
      userId: targetUserId,
      skillDomain: 'devloop-proof',
      hookType: 'synthetic-webhook-proof',
      originalIntent: body.originalIntent,
      triggerConfig: {
        type: 'webhook',
        endpoint: 'hooks/fire',
      },
      ttlMinutes: body.ttlMinutes,
      riskLevel: 'low',
      autoConfirm: true,
      correlationId,
    });

    trackEvent({
      name: 'DurableHookRegistered',
      correlationId,
      userId: targetUserId,
      properties: {
        source: 'devloop-relay',
        endpoint: 'register-hook-proof',
        hookId: registered.hookId,
        hookType: 'synthetic-webhook-proof',
      },
    });

    return {
      status: 200,
      jsonBody: {
        registered: true,
        hookId: registered.hookId,
        correlationId,
        userId: targetUserId,
        message: registered.message,
        firePayloadTemplate: {
          hookId: registered.hookId,
          userId: targetUserId,
          payload: {
            proof: 'synthetic-hook-proof',
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/devloop/new-message — inject a NewMessage event into living session
// ---------------------------------------------------------------------------

app.http('devloopNewMessage', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/new-message',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof InjectNewMessagePayloadSchema>;
    try {
      body = InjectNewMessagePayloadSchema.parse(await req.json());
    } catch {
      return {
        status: 400,
        jsonBody: { error: 'Invalid payload. Required: message, optional correlationPrefix.' },
      };
    }

    const client = df.getClient(context);
    const resolvedInstanceId = body.instanceIdOverride
      ?? await resolveActiveOverseerInstanceId(client, userId);
    if (!resolvedInstanceId) {
      return {
        status: 409,
        jsonBody: { error: 'No routable active overseer instance is available.' },
      };
    }

    const correlationId = `${body.correlationPrefix}-${Date.now()}`;
    recordLimbicIngressDecision({
      source: 'devloop-relay',
      userId,
      correlationId,
      compatibilityMode: getEnvConfig().livingMindCompatibilityMode,
      hasActiveSession: false,
    });

    const event: NewMessageEvent = {
      userMessage: body.message,
      userId,
      userAlias: userId.slice(0, 4),
      correlationId,
    };

    try {
      await client.raiseEvent(resolvedInstanceId, 'NewMessage', event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackEvent({
        name: 'DevLoopRelayPush',
        correlationId,
        userId,
        properties: {
          endpoint: 'new-message',
          deliveredToOverseer: false,
          instanceId: resolvedInstanceId,
          error: message,
        },
      });
      return {
        status: 500,
        jsonBody: {
          error: message,
          instanceId: resolvedInstanceId,
          correlationId,
        },
      };
    }

    trackEvent({
      name: 'DevLoopRelayPush',
      correlationId,
      userId,
      properties: {
        endpoint: 'new-message',
        deliveredToOverseer: true,
        source: 'devloop-relay',
        instanceId: resolvedInstanceId,
      },
    });

    return {
      status: 200,
      jsonBody: {
        correlationId,
        instanceId: resolvedInstanceId,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/devloop/resurrect — Restart a dead/terminated overseer (#92 AC4)
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set<OrchestrationRuntimeStatus>([
  OrchestrationRuntimeStatus.Completed,
  OrchestrationRuntimeStatus.Failed,
  OrchestrationRuntimeStatus.Terminated,
]);

app.http('devloopResurrect', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/resurrect',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const callerId = req.headers.get('x-helkinswarm-user-id');
    if (!callerId || !(await isOwnerUserId(callerId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: ReturnType<typeof ResurrectionCommandSchema.parse>;
    try {
      body = ResurrectionCommandSchema.parse(await req.json());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid payload. Required: userId.' } };
    }

    const targetUserId = body.userId;
    const client = df.getClient(context);
    const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, targetUserId);

    // 1. Check current orchestrator status
    let wasTerminal = false;
    if (activeOverseerInstanceId) {
      const status = await client.getStatus(activeOverseerInstanceId);
      if (status && !TERMINAL_STATUSES.has(status.runtimeStatus)) {
        return {
          status: 200,
          jsonBody: {
            resurrected: false,
            reason: 'Session is already running.',
            runtimeStatus: status.runtimeStatus,
            instanceId: activeOverseerInstanceId,
          },
        };
      }
    }
    // Resurrect is technically obsolete #280 as overseer is a one-shot orchestrator now
    wasTerminal = true;
    const resurrectCorrelationId = `resurrect-${targetUserId}-${Date.now()}`;

    const turnId = crypto.randomUUID().slice(0, 8);
    let startInstanceId = `overseer-${targetUserId}-${turnId}`;

    // 3. If an initial message was provided and we have a conversation reference, inject it
    if (body.initialMessage) {
      const convRef = await getConversationReference(targetUserId);
      if (convRef) {
        recordLimbicIngressDecision({
          source: 'devloop-relay',
          userId: targetUserId,
          correlationId: resurrectCorrelationId,
          compatibilityMode: getEnvConfig().livingMindCompatibilityMode,
          hasActiveSession: false,
        });

        const event: NewMessageEvent = {
          userMessage: body.initialMessage,
          conversationReference: convRef,
          userId: targetUserId,
          userAlias: targetUserId.slice(0, 4),
          correlationId: resurrectCorrelationId,
          devLoopContext: {
            isDevLoop: true,
            prefix: 'DEVLOOP',
            correlationTag: null,
            body: body.initialMessage,
            hasOver: false,
          },
        };
        await client.startNew('overseer', { instanceId: startInstanceId, input: event });
        await signalMindSessionAcquire(client, targetUserId, {
          instanceId: startInstanceId,
          correlationId: resurrectCorrelationId,
          source: 'devloop-relay',
        });
      }
    } else {
      // Not actually starting anything if there is no message, because overseer 
      // now requires a message input (one-shot). But we'll return 200 for back-compat.
      startInstanceId = "skipped-no-message";
    }

    context.log(`[devloopRelay] Resurrect: user=${targetUserId} wasTerminal=${wasTerminal} reason=${body.reason ?? 'none'}`);
    trackEvent({
      name: 'DevLoopRelayPush',
      correlationId: resurrectCorrelationId,
      userId: callerId,
      properties: {
        action: 'resurrect',
        targetUserId,
        wasTerminal,
        reason: body.reason ?? 'none',
        source: 'devloop-relay',
        authority: body.initialMessage ? 'mind-session-guard-acquire' : 'none',
        instanceId: startInstanceId,
      },
    });

    return {
      status: 200,
      jsonBody: {
        resurrected: true,
        instanceId: startInstanceId,
        wasTerminal,
        correlationId: body.initialMessage ? resurrectCorrelationId : null,
        initialMessageInjected: !!body.initialMessage,
      },
    };
  },
});
