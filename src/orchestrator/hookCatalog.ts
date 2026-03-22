// Durable Hook Catalog — Cosmos-backed CRUD for persistent workflow hooks.
// Spec ref: ADDENDA-08-Durable-Hooks-and-Relay-Protocol.md, 0h-Long-Running-Workflows.md
// Container: durableHooks (Bicep-provisioned, partition key: /userId)

import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';

const HOOKS_CONTAINER = 'durableHooks';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const TriggerConfigSchema = z.object({
  type: z.enum(['webhook', 'graphSubscription', 'timer', 'exchangeRule']),
  endpoint: z.string().optional(),
  subscriptionId: z.string().optional(),
  monitoredEmail: z.string().optional(),
  monitoredThread: z.string().optional(),
  cronExpression: z.string().optional(),
});

export const ExpectedReplyPatternSchema = z.object({
  regex: z.string().optional(),
  semantic: z.string().optional(),
  sender: z.string().optional(),
  subjectContains: z.string().optional(),
});

export const DurableHookDocumentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  skillDomain: z.string(),
  hookType: z.string(),
  originalIntent: z.string(),
  expectedReplyPattern: ExpectedReplyPatternSchema.optional(),
  triggerConfig: TriggerConfigSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  lastFiredAt: z.string().optional(),
  status: z.enum(['active', 'paused', 'expired', 'cancelled']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  autoConfirm: z.boolean(),
  externalReferenceId: z.string().optional(),
  correlationId: z.string(),
});

export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;
export type ExpectedReplyPattern = z.infer<typeof ExpectedReplyPatternSchema>;
export type DurableHookDocument = z.infer<typeof DurableHookDocumentSchema>;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegisterHookInput {
  userId: string;
  skillDomain: string;
  hookType: string;
  originalIntent: string;
  expectedReplyPattern?: ExpectedReplyPattern;
  triggerConfig: TriggerConfig;
  ttlMinutes: number;
  riskLevel: 'low' | 'medium' | 'high';
  autoConfirm?: boolean;
  correlationId: string;
}

export interface RegisterHookResult {
  registered: boolean;
  hookId: string;
  message: string;
}

export async function registerHook(input: RegisterHookInput): Promise<RegisterHookResult> {
  const container = getContainer(HOOKS_CONTAINER);
  const hookId = crypto.randomUUID();

  const hookDoc: DurableHookDocument = {
    id: hookId,
    userId: input.userId,
    skillDomain: input.skillDomain,
    hookType: input.hookType,
    originalIntent: input.originalIntent,
    expectedReplyPattern: input.expectedReplyPattern,
    triggerConfig: input.triggerConfig,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + input.ttlMinutes * 60 * 1000).toISOString(),
    status: 'active',
    riskLevel: input.riskLevel,
    autoConfirm: input.autoConfirm ?? false,
    correlationId: input.correlationId,
  };

  // Validate before persisting
  DurableHookDocumentSchema.parse(hookDoc);

  await container.items.upsert(hookDoc);

  return {
    registered: true,
    hookId,
    message: `Hook '${input.hookType}' registered for ${input.skillDomain} (expires in ${input.ttlMinutes}m).`,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getHookById(hookId: string, userId: string): Promise<DurableHookDocument | undefined> {
  const container = getContainer(HOOKS_CONTAINER);
  try {
    const { resource } = await container.item(hookId, userId).read<DurableHookDocument>();
    return resource ?? undefined;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function listActiveHooks(userId: string): Promise<DurableHookDocument[]> {
  const container = getContainer(HOOKS_CONTAINER);
  const now = new Date().toISOString();
  const { resources } = await container.items
    .query<DurableHookDocument>({
      query: 'SELECT * FROM c WHERE c.userId = @uid AND c.status = @status AND c.expiresAt > @now',
      parameters: [
        { name: '@uid', value: userId },
        { name: '@status', value: 'active' },
        { name: '@now', value: now },
      ],
    })
    .fetchAll();
  return resources;
}

export async function listAllHooks(userId: string): Promise<DurableHookDocument[]> {
  const container = getContainer(HOOKS_CONTAINER);
  const { resources } = await container.items
    .query<DurableHookDocument>({
      query: 'SELECT * FROM c WHERE c.userId = @uid ORDER BY c.createdAt DESC',
      parameters: [{ name: '@uid', value: userId }],
    })
    .fetchAll();
  return resources;
}

// ---------------------------------------------------------------------------
// Lifecycle — pause, resume, cancel, fire
// ---------------------------------------------------------------------------

async function patchHookStatus(
  hookId: string,
  userId: string,
  status: DurableHookDocument['status'],
): Promise<void> {
  const container = getContainer(HOOKS_CONTAINER);
  await container.item(hookId, userId).patch({
    operations: [{ op: 'replace', path: '/status', value: status }],
  });
}

export async function pauseHook(hookId: string, userId: string): Promise<void> {
  await patchHookStatus(hookId, userId, 'paused');
}

export async function resumeHook(hookId: string, userId: string): Promise<void> {
  await patchHookStatus(hookId, userId, 'active');
}

export async function cancelHook(hookId: string, userId: string): Promise<void> {
  await patchHookStatus(hookId, userId, 'cancelled');
}

export async function recordHookFired(hookId: string, userId: string): Promise<void> {
  const container = getContainer(HOOKS_CONTAINER);
  await container.item(hookId, userId).patch({
    operations: [{ op: 'replace', path: '/lastFiredAt', value: new Date().toISOString() }],
  });
}

// ---------------------------------------------------------------------------
// Emergency Stop — pause all active hooks for a user
// ---------------------------------------------------------------------------

export async function pauseAllHooksForUser(userId: string): Promise<number> {
  const activeHooks = await listActiveHooks(userId);
  await Promise.all(
    activeHooks.map((hook) => pauseHook(hook.id, userId)),
  );
  return activeHooks.length;
}

// ---------------------------------------------------------------------------
// Expiration sweep — mark expired hooks (called by timer or activity)
// ---------------------------------------------------------------------------

export async function expireOverdueHooks(userId: string): Promise<number> {
  const container = getContainer(HOOKS_CONTAINER);
  const now = new Date().toISOString();
  const { resources } = await container.items
    .query<DurableHookDocument>({
      query: 'SELECT * FROM c WHERE c.userId = @uid AND c.status = @status AND c.expiresAt <= @now',
      parameters: [
        { name: '@uid', value: userId },
        { name: '@status', value: 'active' },
        { name: '@now', value: now },
      ],
    })
    .fetchAll();

  await Promise.all(
    resources.map((hook) => patchHookStatus(hook.id, userId, 'expired')),
  );
  return resources.length;
}
