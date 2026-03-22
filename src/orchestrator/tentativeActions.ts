// Tentative Actions — pending mutations that require user confirmation before execution.
// When a durable hook fires and fuzzy matching succeeds, the system creates tentative
// actions (calendar entries, bookings, etc.) in pending state, then asks the user to confirm.
// Spec ref: 0h-Long-Running-Workflows.md §5 (Workflow Engine), Issue #74

import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';

const TENTATIVE_CONTAINER = 'tentativeActions';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const TentativeActionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  hookId: z.string(),
  correlationId: z.string(),
  actionType: z.enum([
    'calendar_create',
    'calendar_update',
    'email_reply',
    'booking_confirm',
    'payment_authorize',
    'custom',
  ]),
  status: z.enum(['pending', 'approved', 'denied', 'expired', 'executed']),
  summary: z.string(),
  details: z.record(z.unknown()),
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedAt: z.string().optional(),
  executedAt: z.string().optional(),
});

export type TentativeAction = z.infer<typeof TentativeActionSchema>;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateTentativeInput {
  userId: string;
  hookId: string;
  correlationId: string;
  actionType: TentativeAction['actionType'];
  summary: string;
  details: Record<string, unknown>;
  ttlMinutes?: number;
}

/**
 * Create a tentative action in pending state.
 * Returns the action ID for use in confirmation cards.
 */
export async function createTentativeAction(
  input: CreateTentativeInput,
): Promise<TentativeAction> {
  const container = getContainer(TENTATIVE_CONTAINER);
  const actionId = crypto.randomUUID();
  const ttl = input.ttlMinutes ?? 60;

  const action: TentativeAction = {
    id: actionId,
    userId: input.userId,
    hookId: input.hookId,
    correlationId: input.correlationId,
    actionType: input.actionType,
    status: 'pending',
    summary: input.summary,
    details: input.details,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 60 * 1000).toISOString(),
  };

  TentativeActionSchema.parse(action);
  await container.items.upsert(action);
  return action;
}

/**
 * Get a tentative action by ID.
 */
export async function getTentativeAction(
  actionId: string,
  userId: string,
): Promise<TentativeAction | undefined> {
  const container = getContainer(TENTATIVE_CONTAINER);
  try {
    const { resource } = await container.item(actionId, userId).read<TentativeAction>();
    return resource ?? undefined;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return undefined;
    }
    throw err;
  }
}

/**
 * List all pending tentative actions for a user.
 */
export async function listPendingActions(userId: string): Promise<TentativeAction[]> {
  const container = getContainer(TENTATIVE_CONTAINER);
  const now = new Date().toISOString();
  const { resources } = await container.items
    .query<TentativeAction>({
      query: 'SELECT * FROM c WHERE c.userId = @uid AND c.status = @status AND c.expiresAt > @now ORDER BY c.createdAt DESC',
      parameters: [
        { name: '@uid', value: userId },
        { name: '@status', value: 'pending' },
        { name: '@now', value: now },
      ],
    })
    .fetchAll();
  return resources;
}

/**
 * Approve a tentative action — marks it as approved for execution.
 */
export async function approveTentativeAction(
  actionId: string,
  userId: string,
): Promise<void> {
  const container = getContainer(TENTATIVE_CONTAINER);
  await container.item(actionId, userId).patch({
    operations: [
      { op: 'replace', path: '/status', value: 'approved' },
      { op: 'add', path: '/decidedAt', value: new Date().toISOString() },
    ],
  });
}

/**
 * Deny a tentative action — marks it as denied.
 */
export async function denyTentativeAction(
  actionId: string,
  userId: string,
): Promise<void> {
  const container = getContainer(TENTATIVE_CONTAINER);
  await container.item(actionId, userId).patch({
    operations: [
      { op: 'replace', path: '/status', value: 'denied' },
      { op: 'add', path: '/decidedAt', value: new Date().toISOString() },
    ],
  });
}

/**
 * Mark a tentative action as executed.
 */
export async function markActionExecuted(
  actionId: string,
  userId: string,
): Promise<void> {
  const container = getContainer(TENTATIVE_CONTAINER);
  await container.item(actionId, userId).patch({
    operations: [
      { op: 'replace', path: '/status', value: 'executed' },
      { op: 'add', path: '/executedAt', value: new Date().toISOString() },
    ],
  });
}

/**
 * Expire all overdue pending actions for a user.
 */
export async function expireOverdueActions(userId: string): Promise<number> {
  const container = getContainer(TENTATIVE_CONTAINER);
  const now = new Date().toISOString();
  const { resources } = await container.items
    .query<TentativeAction>({
      query: 'SELECT * FROM c WHERE c.userId = @uid AND c.status = @status AND c.expiresAt <= @now',
      parameters: [
        { name: '@uid', value: userId },
        { name: '@status', value: 'pending' },
        { name: '@now', value: now },
      ],
    })
    .fetchAll();

  await Promise.all(
    resources.map((a) =>
      container.item(a.id, userId).patch({
        operations: [{ op: 'replace', path: '/status', value: 'expired' }],
      }),
    ),
  );
  return resources.length;
}
