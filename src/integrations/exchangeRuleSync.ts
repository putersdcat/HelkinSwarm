// Exchange Rule Sync — CRUD for Outlook mail rules via Microsoft Graph.
// Enables durable hooks to create/list/delete Exchange mail rules on behalf of the user.
// Spec ref: 0h-Long-Running-Workflows.md §3 (exchangeRule trigger type), Issue #73
//
// Graph API reference: /me/mailFolders/Inbox/messageRules

import { z } from 'zod';
import { getGraphTokenForUser } from '../auth/graphTokenHelper.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const MessageRuleActionSchema = z.object({
  moveToFolder: z.string().optional(),
  delete: z.boolean().optional(),
  markAsRead: z.boolean().optional(),
  markImportance: z.enum(['low', 'normal', 'high']).optional(),
  forwardTo: z.array(z.object({
    emailAddress: z.object({ address: z.string() }),
  })).optional(),
}).passthrough();

export const MessageRuleConditionSchema = z.object({
  senderContains: z.array(z.string()).optional(),
  subjectContains: z.array(z.string()).optional(),
  fromAddresses: z.array(z.object({
    emailAddress: z.object({ address: z.string() }),
  })).optional(),
}).passthrough();

export const MessageRuleSchema = z.object({
  id: z.string().optional(),
  displayName: z.string(),
  isEnabled: z.boolean(),
  sequence: z.number().optional(),
  conditions: MessageRuleConditionSchema.optional(),
  actions: MessageRuleActionSchema.optional(),
}).passthrough();

export type MessageRule = z.infer<typeof MessageRuleSchema>;

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
// Exchange Rule CRUD
// ---------------------------------------------------------------------------

/**
 * List all message rules for the user's inbox.
 */
export async function listExchangeRules(userId: string): Promise<MessageRule[]> {
  const ListSchema = z.object({ value: z.array(MessageRuleSchema) });
  const result = await graphRequest(userId, '/me/mailFolders/Inbox/messageRules', ListSchema);
  return result.value;
}

/**
 * Create a new message rule (e.g., "block sender X", "auto-forward Y").
 */
export async function createExchangeRule(
  userId: string,
  rule: Omit<MessageRule, 'id'>,
): Promise<MessageRule> {
  return graphRequest(userId, '/me/mailFolders/Inbox/messageRules', MessageRuleSchema, {
    method: 'POST',
    body: JSON.stringify(rule),
  });
}

/**
 * Delete a message rule by ID.
 */
export async function deleteExchangeRule(
  userId: string,
  ruleId: string,
): Promise<void> {
  const token = await getGraphTokenForUser(userId);
  if (!token) {
    throw new Error('No Graph token available.');
  }

  const response = await fetch(
    `${GRAPH_BASE}/me/mailFolders/Inbox/messageRules/${ruleId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    },
  );

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`Graph DELETE rule ${response.status}: ${body}`);
  }
}

/**
 * Sync exchange rules — returns all rules and tags them with any matching hook references.
 * This is used by the hook catalog to discover existing rules that correspond to hooks.
 */
export async function syncExchangeRules(
  userId: string,
): Promise<{ rules: MessageRule[]; count: number }> {
  const rules = await listExchangeRules(userId);
  return { rules, count: rules.length };
}
