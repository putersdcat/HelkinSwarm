// Teams skill handlers — Graph API operations for Teams chat intelligence.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #261
//
// Auth: OBO delegated tokens via Bot Framework OAuth connection (GraphOAuth).
// The user must run /link first to cache a Graph token in the Bot Token Service.
// conversationId is injected automatically by toolDispatchActivity (no LLM input needed).

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';
import { getGraphTokenForUser } from '../../src/auth/graphTokenHelper.js';
import { registerHandler } from '../../src/capabilities/capabilityLoader.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphFetch<T>(
  userId: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const token = await getGraphTokenForUser(userId);
  if (!token) {
    throw new Error('No Graph token available. Please run /link first to connect your Microsoft account.');
  }

  const response = await fetch(`${GRAPH_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Graph API ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as unknown;
  return schema.parse(data);
}

// ---------------------------------------------------------------------------
// Zod schemas for Graph API reactions response
// ---------------------------------------------------------------------------

const ReactionUserSchema = z.object({
  user: z.object({
    id: z.string().optional(),
    displayName: z.string().optional(),
  }).optional(),
});

const ChatMessageReactionSchema = z.object({
  reactionType: z.string(),
  displayName: z.string().optional(),
  createdDateTime: z.string().optional(),
  user: ReactionUserSchema.optional(),
});

const ChatMessageSchema = z.object({
  id: z.string(),
  createdDateTime: z.string().optional(),
  body: z.object({ content: z.string().optional() }).optional(),
  reactions: z.array(ChatMessageReactionSchema).default([]),
});

// ---------------------------------------------------------------------------
// teams_get_message_reactions — fetch reactions on a specific message (#261)
// ---------------------------------------------------------------------------

const teamsGetMessageReactions: ToolHandler = async (args) => {
  const userId = z.string().parse(args['userId']);
  const messageId = z.string().min(1).parse(args['messageId']);

  // chatId: explicit arg OR injected conversationId from dispatch context
  const rawChatId = args['chatId'] ?? args['conversationId'];
  if (!rawChatId || typeof rawChatId !== 'string' || rawChatId.trim() === '') {
    throw new Error(
      'chatId is required. Either provide it explicitly or ensure HelkinSwarm is running in a Teams chat context where conversationId is available.',
    );
  }
  const chatId = rawChatId.trim();

  const path = `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}?$select=id,reactions,createdDateTime`;
  const message = await graphFetch(userId, path, ChatMessageSchema);

  const reactions = message.reactions ?? [];

  if (reactions.length === 0) {
    return { messageId, chatId, reactions: [], summary: 'No reactions on this message.' };
  }

  // Group reactions by type for a clean summary
  const grouped = new Map<string, { count: number; reactors: string[]; latestAt?: string }>();
  for (const r of reactions) {
    const key = r.reactionType;
    const entry = grouped.get(key) ?? { count: 0, reactors: [], latestAt: r.createdDateTime };
    entry.count++;
    const name = r.user?.user?.displayName ?? r.displayName;
    if (name) entry.reactors.push(name);
    if (r.createdDateTime && (!entry.latestAt || r.createdDateTime > entry.latestAt)) {
      entry.latestAt = r.createdDateTime;
    }
    grouped.set(key, entry);
  }

  const breakdownLines: string[] = [];
  for (const [type, info] of grouped) {
    const who = info.reactors.length > 0 ? ` (from: ${info.reactors.join(', ')})` : '';
    breakdownLines.push(`${type} × ${info.count}${who}`);
  }

  return {
    messageId,
    chatId,
    totalReactions: reactions.length,
    breakdown: Array.from(grouped.entries()).map(([type, info]) => ({
      reactionType: type,
      count: info.count,
      reactors: info.reactors,
      latestAt: info.latestAt,
    })),
    summary: breakdownLines.join('; '),
  };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const handlers: Record<string, ToolHandler> = {
  teams_get_message_reactions: teamsGetMessageReactions,
};

for (const [name, handler] of Object.entries(handlers)) {
  registerHandler(name, handler);
}
