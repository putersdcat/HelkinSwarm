// Handoff to Fresh Overseer Activity — starts a brand-new overseer instance
// for a buffered/drained message, giving it a clean Durable history.
//
// This solves the Azure Storage history replay degradation problem (#598):
// each overseer instance handles exactly ONE turn. When a buffered follower
// message needs processing, the current instance hands off to a fresh one
// instead of looping (which would grow history unboundedly and make every
// subsequent yield replay all prior events).
//
// Pattern: extraInputs: [df.input.durableClient()] + df.getClient(context)
// Same as terminateOrchestrationActivity / purgeOrchestrationActivity.

import * as df from 'durable-functions';
import type { InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { signalMindSessionAcquire } from './mindSessionGuard.js';
import type { NewMessageEvent } from './overseer.js';

export const HandoffToFreshOverseerInputSchema = z.object({
  event: z.record(z.unknown()),
  userId: z.string().min(1),
  correlationId: z.string().min(1),
});

export interface HandoffToFreshOverseerInput {
  event: NewMessageEvent;
  userId: string;
  correlationId: string;
}

export interface HandoffToFreshOverseerResult {
  instanceId: string;
  started: boolean;
}

df.app.activity('handoffToFreshOverseerActivity', {
  extraInputs: [df.input.durableClient()],
  handler: async (
    rawInput: unknown,
    context: InvocationContext,
  ): Promise<HandoffToFreshOverseerResult> => {
    const input = HandoffToFreshOverseerInputSchema.parse(rawInput);
    const client = df.getClient(context);

    // Generate a unique instanceId for the fresh overseer.
    // Use a UUID suffix to guarantee no collision with any existing instance.
    const freshInstanceId = `overseer-${input.userId}-${crypto.randomUUID().slice(0, 12)}`;

    try {
      // Start a brand-new overseer with clean history
      await client.startNew('overseer', {
        instanceId: freshInstanceId,
        input: input.event,
      });

      // Acquire the mind session guard for the fresh instance
      await signalMindSessionAcquire(client, input.userId, {
        instanceId: freshInstanceId,
        correlationId: input.correlationId,
        source: 'overseer-handoff',
      });

      console.log(
        `[handoffToFreshOverseer] Started fresh overseer ${freshInstanceId} for user=${input.userId} correlationId=${input.correlationId}`,
      );
      return { instanceId: freshInstanceId, started: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 409 = instance already exists — safe to treat as success (dedup)
      if (msg.includes('409') || msg.includes('already exists') || msg.includes('conflict')) {
        console.info(
          `[handoffToFreshOverseer] Instance ${freshInstanceId} already exists — dedup safe`,
        );
        return { instanceId: freshInstanceId, started: true };
      }
      console.error(
        `[handoffToFreshOverseer] Failed to start fresh overseer ${freshInstanceId}: ${msg}`,
      );
      return { instanceId: freshInstanceId, started: false };
    }
  },
});
