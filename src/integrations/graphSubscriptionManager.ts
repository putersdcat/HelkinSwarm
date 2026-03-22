// Graph Subscription Manager — create, renew, delete Microsoft Graph subscriptions.
// Used by durable hooks to watch inbox, calendar, channels, etc. for changes.
// Spec ref: 0h-Long-Running-Workflows.md §3, Issue #73
//
// Graph subscriptions deliver change notifications via webhook to our notification endpoint.
// Max lifetime: 4230 minutes (~3 days) for most resources. We auto-renew before expiry.

import { z } from 'zod';
import { getGraphTokenForUser } from '../auth/graphTokenHelper.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const GraphSubscriptionSchema = z.object({
  id: z.string(),
  resource: z.string(),
  changeType: z.string(),
  notificationUrl: z.string(),
  expirationDateTime: z.string(),
  clientState: z.string().optional(),
});

export type GraphSubscription = z.infer<typeof GraphSubscriptionSchema>;

export interface CreateSubscriptionInput {
  userId: string;
  /** Graph resource path, e.g. "me/mailFolders/Inbox/messages" */
  resource: string;
  /** Comma-separated change types: "created", "updated", "deleted" */
  changeType: string;
  /** Our webhook notification URL */
  notificationUrl: string;
  /** Client-state secret for request validation */
  clientState: string;
  /** Subscription lifetime in minutes (max 4230 for most resources) */
  lifetimeMinutes?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function graphRequest<T>(
  userId: string,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const token = await getGraphTokenForUser(userId);
  if (!token) {
    throw new Error('No Graph token available. User must run /link first.');
  }

  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph API ${response.status} on ${path}: ${body}`);
  }

  const data = await response.json() as unknown;
  return schema.parse(data);
}

// ---------------------------------------------------------------------------
// Subscription CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new Graph subscription (webhook).
 * The subscription will POST change notifications to notificationUrl.
 */
export async function createGraphSubscription(
  input: CreateSubscriptionInput,
): Promise<GraphSubscription> {
  const lifetimeMinutes = Math.min(input.lifetimeMinutes ?? 4230, 4230);
  const expirationDateTime = new Date(
    Date.now() + lifetimeMinutes * 60 * 1000,
  ).toISOString();

  return graphRequest(input.userId, '/subscriptions', GraphSubscriptionSchema, {
    method: 'POST',
    body: JSON.stringify({
      changeType: input.changeType,
      notificationUrl: input.notificationUrl,
      resource: input.resource,
      expirationDateTime,
      clientState: input.clientState,
    }),
  });
}

/**
 * Renew an existing subscription by extending its expiration.
 */
export async function renewGraphSubscription(
  userId: string,
  subscriptionId: string,
  lifetimeMinutes?: number,
): Promise<GraphSubscription> {
  const minutes = Math.min(lifetimeMinutes ?? 4230, 4230);
  const expirationDateTime = new Date(
    Date.now() + minutes * 60 * 1000,
  ).toISOString();

  return graphRequest(
    userId,
    `/subscriptions/${subscriptionId}`,
    GraphSubscriptionSchema,
    {
      method: 'PATCH',
      body: JSON.stringify({ expirationDateTime }),
    },
  );
}

/**
 * Delete a Graph subscription.
 */
export async function deleteGraphSubscription(
  userId: string,
  subscriptionId: string,
): Promise<void> {
  const token = await getGraphTokenForUser(userId);
  if (!token) {
    throw new Error('No Graph token available.');
  }

  const response = await fetch(
    `${GRAPH_BASE}/subscriptions/${subscriptionId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    },
  );

  // 204 = success, 404 = already deleted — both fine
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`Graph DELETE subscription ${response.status}: ${body}`);
  }
}

/**
 * List all active Graph subscriptions for a user.
 */
export async function listGraphSubscriptions(
  userId: string,
): Promise<GraphSubscription[]> {
  const ListSchema = z.object({
    value: z.array(GraphSubscriptionSchema),
  });

  const result = await graphRequest(userId, '/subscriptions', ListSchema);
  return result.value;
}
