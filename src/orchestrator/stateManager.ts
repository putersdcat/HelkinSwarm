// State manager — loads and persists overseer state for ContinueAsNew cycles.
// Spec ref: 08-Orchestrator-Patterns.md
// Phase 4 will swap the in-memory stub for Cosmos DB persistence.

import { z } from 'zod';

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
