// Durable Hook activity — stub for Phase 3/4 long-running workflow hooks.
// Spec ref: 0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md

import * as df from 'durable-functions';

export interface DurableHookInput {
  hookId: string;
  taskType: string;
  originalIntent: string;
  expectedPattern?: string;
  timeoutMinutes?: number;
}

export interface DurableHookResult {
  registered: boolean;
  hookId: string;
  message: string;
}

df.app.activity('durableHookActivity', {
  handler: (input: DurableHookInput): DurableHookResult => {
    // Phase 3/4 will implement full hook registration in Cosmos DB
    // and set up webhook listeners / Graph subscriptions.
    return {
      registered: false,
      hookId: input.hookId,
      message: `Durable hook '${input.taskType}' acknowledged but not yet active (Phase 3/4).`,
    };
  },
});
