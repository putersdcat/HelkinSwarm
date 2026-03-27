// Terminate Orchestration Activity — terminates a running Durable orchestration by instanceId.
// Used by overseer to kill timed-out sub-orchestrators (prevents zombie sessions).
// Spec ref: #325

import * as df from 'durable-functions';
import type { InvocationContext } from '@azure/functions';

export interface TerminateOrchestrationInput {
  instanceId: string;
  reason: string;
}

df.app.activity('terminateOrchestrationActivity', {
  extraInputs: [df.input.durableClient()],
  handler: async (
    input: TerminateOrchestrationInput,
    context: InvocationContext,
  ): Promise<{ terminated: boolean; instanceId: string }> => {
    const client = df.getClient(context);
    try {
      await client.terminate(input.instanceId, input.reason);
      console.log(`[terminateOrchestration] Terminated ${input.instanceId}: ${input.reason}`);
      return { terminated: true, instanceId: input.instanceId };
    } catch (err) {
      // Instance may already be completed/terminated — not an error
      console.warn(
        `[terminateOrchestration] Could not terminate ${input.instanceId}: ${err instanceof Error ? err.message : err}`,
      );
      return { terminated: false, instanceId: input.instanceId };
    }
  },
});

// Purge Orchestration Activity — terminate + purge history for an instance.
// Called BEFORE starting a sub-orchestrator to ensure no stale instances block dispatch (#327).
export interface PurgeOrchestrationInput {
  instanceId: string;
}

df.app.activity('purgeOrchestrationActivity', {
  extraInputs: [df.input.durableClient()],
  handler: async (
    input: PurgeOrchestrationInput,
    context: InvocationContext,
  ): Promise<{ purged: boolean; instanceId: string }> => {
    const client = df.getClient(context);
    try {
      // Terminate first (if running), then purge history
      try { await client.terminate(input.instanceId, 'pre-purge'); } catch { /* ignore */ }
      const result = await client.purgeInstanceHistory(input.instanceId);
      console.log(`[purgeOrchestration] Purged ${input.instanceId}: deleted=${result.instancesDeleted}`);
      return { purged: result.instancesDeleted > 0, instanceId: input.instanceId };
    } catch (err) {
      console.warn(
        `[purgeOrchestration] Could not purge ${input.instanceId}: ${err instanceof Error ? err.message : err}`,
      );
      return { purged: false, instanceId: input.instanceId };
    }
  },
});
