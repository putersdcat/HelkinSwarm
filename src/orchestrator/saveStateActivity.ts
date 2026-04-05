// Activity: persist overseer state to Cosmos DB.
// Called after each turn and before ContinueAsNew.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { OverseerState } from './stateManager.js';
import { saveState } from './stateManager.js';
import { recordSubstage } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';

const SAVE_STATE_TIMEOUT_MS = 5_000;

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`saveStateActivity timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export interface SaveStateInput {
  state: OverseerState;
  correlationId?: string;
}

df.app.activity('saveStateActivity', {
  handler: async (input: SaveStateInput): Promise<void> => {
    if (input.correlationId) {
      recordSubstage(input.correlationId, 'save-state', input.state.userId);
    }

    try {
      await withTimeout(saveState(input.state), SAVE_STATE_TIMEOUT_MS);
      trackEvent({ name: 'StateSaved', correlationId: input.correlationId ?? input.state.userId, userId: input.state.userId, properties: {
        turnCount: input.state.turnCount,
        totalTokens: input.state.totalTokens,
      } });
    } catch (err) {
      console.warn(
        `[saveStateActivity] Skipping state persistence after timeout/error: ${err instanceof Error ? err.message : err}`,
      );
    }
  },
});
