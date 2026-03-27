// Activity: load overseer state from Cosmos DB.
// Called on overseer startup to restore session context.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { OverseerState } from './stateManager.js';
import { loadState } from './stateManager.js';
import { trackEvent } from '../observability/telemetry.js';
import { recordOrchestratorStage } from '../observability/orchestratorStageHealth.js';

export interface LoadStateInput {
  userId: string;
  correlationId?: string;
}

const LOAD_STATE_TIMEOUT_MS = 3_000;

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`loadState timed out after ${timeoutMs}ms`);
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

df.app.activity('loadStateActivity', {
  handler: async (input: LoadStateInput): Promise<OverseerState | null> => {
    const correlationId = input.correlationId ?? input.userId;
    await recordOrchestratorStage(correlationId, 'load-state', input.userId);
    try {
      const state = await withTimeout(loadState(input.userId), LOAD_STATE_TIMEOUT_MS);
      trackEvent({ name: 'StateLoaded', correlationId, userId: input.userId, properties: {
        found: state !== null,
      } });
      return state ?? null;
    } catch (err) {
      trackEvent({ name: 'StateLoaded', correlationId, userId: input.userId, properties: {
        error: err instanceof Error ? err.message : String(err),
        found: false,
        timeout: true,
      } });
      console.warn(`[loadStateActivity] Falling back to empty state for userId=${input.userId}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  },
});
