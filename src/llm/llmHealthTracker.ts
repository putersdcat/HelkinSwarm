// LLM aggregate health tracker — in-memory success/failure tracking per model.
// Reports whether ALL models in the fallback chain are currently down.
// Resets on cold start (by design — same as modelCircuitBreaker).
// Spec ref: #325

export type LlmAggregateHealth = 'ok' | 'degraded' | 'down';

interface ModelHealthEntry {
  lastSuccessAt: number;
  lastFailureAt: number;
  consecutiveFailures: number;
}

/** Window in which we consider a model "recently failed". */
const FAILURE_WINDOW_MS = 5 * 60_000; // 5 minutes

/** After this many consecutive failures without a success, a model is considered "down". */
const DOWN_THRESHOLD = 2;

const healthMap = new Map<string, ModelHealthEntry>();

/** All model names ever registered (from fallback chain). */
const knownModels = new Set<string>();

/** Register models from the fallback chain so we know the full set. */
export function registerModels(deploymentNames: string[]): void {
  for (const name of deploymentNames) {
    knownModels.add(name);
  }
}

/** Report a successful LLM call. */
export function reportLlmSuccess(deploymentName: string): void {
  knownModels.add(deploymentName);
  healthMap.set(deploymentName, {
    lastSuccessAt: Date.now(),
    lastFailureAt: healthMap.get(deploymentName)?.lastFailureAt ?? 0,
    consecutiveFailures: 0,
  });
}

/** Report a failed LLM call. */
export function reportLlmFailure(deploymentName: string): void {
  knownModels.add(deploymentName);
  const existing = healthMap.get(deploymentName);
  healthMap.set(deploymentName, {
    lastSuccessAt: existing?.lastSuccessAt ?? 0,
    lastFailureAt: Date.now(),
    consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
  });
}

function isModelDown(entry: ModelHealthEntry | undefined): boolean {
  if (!entry) return false; // never called = not down
  if (entry.consecutiveFailures < DOWN_THRESHOLD) return false;
  // Model has enough consecutive failures. Check if it recovered recently.
  if (entry.lastSuccessAt > entry.lastFailureAt) return false;
  // Check if failures are within the window.
  return (Date.now() - entry.lastFailureAt) < FAILURE_WINDOW_MS;
}

/**
 * Get aggregate LLM health across all known models.
 * - 'ok': at least one model has succeeded recently or never failed
 * - 'degraded': some models are down but at least one is healthy
 * - 'down': ALL known models have failed recently with no success
 */
export function getLlmAggregateHealth(): LlmAggregateHealth {
  if (knownModels.size === 0) return 'ok'; // no calls yet

  let downCount = 0;
  for (const model of knownModels) {
    const entry = healthMap.get(model);
    if (isModelDown(entry)) {
      downCount++;
    }
  }

  if (downCount === 0) return 'ok';
  if (downCount >= knownModels.size) return 'down';
  return 'degraded';
}

/** Check if ALL known models are down. Used for fast-fail circuit-open check. */
export function isAllModelsDown(): boolean {
  return getLlmAggregateHealth() === 'down';
}

/** Get a snapshot of per-model health for Dev Console / diagnostics. */
export function getLlmHealthSnapshot(): {
  aggregate: LlmAggregateHealth;
  models: Array<{
    deploymentName: string;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    consecutiveFailures: number;
    isDown: boolean;
  }>;
} {
  const models = Array.from(knownModels).map((name) => {
    const entry = healthMap.get(name);
    return {
      deploymentName: name,
      lastSuccessAt: entry?.lastSuccessAt ? new Date(entry.lastSuccessAt).toISOString() : null,
      lastFailureAt: entry?.lastFailureAt ? new Date(entry.lastFailureAt).toISOString() : null,
      consecutiveFailures: entry?.consecutiveFailures ?? 0,
      isDown: isModelDown(entry),
    };
  });

  return {
    aggregate: getLlmAggregateHealth(),
    models,
  };
}

/** Reset all health state (primarily for tests). */
export function resetLlmHealthTracker(): void {
  healthMap.clear();
  knownModels.clear();
}
