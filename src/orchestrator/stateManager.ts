// State manager — loads and persists overseer state for ContinueAsNew cycles.
// Spec ref: 08-Orchestrator-Patterns.md

import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';

const SESSIONS_CONTAINER = 'sessions';
const TTL_SECONDS = 72 * 60 * 60; // 72h

export const OverseerStateSchema = z.object({
  userId: z.string(),
  userAlias: z.string(),
  conversationId: z.string(),
  summary: z.string().default(''),
  turnCount: z.number().default(0),
  totalTokens: z.number().default(0),
  maxTokens: z.number().default(128_000),
  lastActivityTimestamp: z.string().datetime().optional(),
  pendingHooks: z.array(z.string()).default([]),
  safetyMode: z.string().default('confirmation-gated'),
  euResidencyMode: z.boolean().default(false),
});

export type OverseerState = z.infer<typeof OverseerStateSchema>;

export function createInitialState(input: {
  userId: string;
  userAlias: string;
  conversationId: string;
}): OverseerState {
  return OverseerStateSchema.parse({
    userId: input.userId,
    userAlias: input.userAlias,
    conversationId: input.conversationId,
  });
}

export function stateForContinueAsNew(
  current: OverseerState,
  summary: string,
): OverseerState {
  return {
    ...current,
    summary,
    turnCount: 0,
    totalTokens: 0,
    lastActivityTimestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cosmos DB persistence
// ---------------------------------------------------------------------------

interface SessionDocument {
  id: string;
  userId: string;
  state: OverseerState;
  updatedAt: string;
  ttl: number;
}

/**
 * Load overseer state from Cosmos sessions container.
 * Returns undefined if no session exists for this user.
 */
export async function loadState(userId: string): Promise<OverseerState | undefined> {
  const container = getContainer(SESSIONS_CONTAINER);
  try {
    const { resource } = await container.item(userId, userId).read<SessionDocument>();
    if (!resource) return undefined;
    return OverseerStateSchema.parse(resource.state);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Save overseer state to Cosmos sessions container.
 * Uses upsert with 72h TTL. Partition key: userId.
 */
export async function saveState(state: OverseerState): Promise<void> {
  const container = getContainer(SESSIONS_CONTAINER);
  const doc: SessionDocument = {
    id: state.userId,
    userId: state.userId,
    state,
    updatedAt: new Date().toISOString(),
    ttl: TTL_SECONDS,
  };
  await container.items.upsert(doc);
}
