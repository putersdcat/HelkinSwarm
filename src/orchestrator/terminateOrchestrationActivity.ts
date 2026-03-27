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
