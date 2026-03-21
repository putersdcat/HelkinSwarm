// Activity: persist overseer state to Cosmos DB.
// Called after each turn and before ContinueAsNew.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { OverseerState } from './stateManager.js';
import { saveState } from './stateManager.js';

export interface SaveStateInput {
  state: OverseerState;
}

df.app.activity('saveStateActivity', {
  handler: async (input: SaveStateInput): Promise<void> => {
    await saveState(input.state);
  },
});
