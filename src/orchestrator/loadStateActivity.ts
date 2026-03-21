// Activity: load overseer state from Cosmos DB.
// Called on overseer startup to restore session context.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { OverseerState } from './stateManager.js';
import { loadState } from './stateManager.js';

export interface LoadStateInput {
  userId: string;
}

df.app.activity('loadStateActivity', {
  handler: async (input: LoadStateInput): Promise<OverseerState | null> => {
    const state = await loadState(input.userId);
    return state ?? null;
  },
});
