// Model circuit breaker — tracks degraded models and skips them during fallback.
// In-memory state; resets on Function App cold start (by design — #152).

export interface DegradedModel {
  deploymentName: string;
  degradedAt: number;
  reason: string;
  failureCount: number;
}

const DEFAULT_COOLDOWN_MS = 60_000; // 60 seconds

/** In-memory degraded model registry. */
const degradedModels = new Map<string, DegradedModel>();

/** Mark a model as degraded so subsequent requests skip it. */
export function markModelDegraded(deploymentName: string, reason: string): void {
  const existing = degradedModels.get(deploymentName);
  degradedModels.set(deploymentName, {
    deploymentName,
    degradedAt: Date.now(),
    reason,
    failureCount: (existing?.failureCount ?? 0) + 1,
  });
}

/** Check whether a model is currently degraded (within cooldown). */
export function isModelDegraded(deploymentName: string, cooldownMs: number = DEFAULT_COOLDOWN_MS): boolean {
  const entry = degradedModels.get(deploymentName);
  if (!entry) return false;

  const elapsed = Date.now() - entry.degradedAt;
  if (elapsed >= cooldownMs) {
    // Cooldown expired — model can be retried
    degradedModels.delete(deploymentName);
    return false;
  }
  return true;
}

/** Clear a specific model's degraded status (e.g. after a successful call). */
export function clearModelDegraded(deploymentName: string): void {
  degradedModels.delete(deploymentName);
}

/** Get all currently degraded models (for telemetry / Dev Console). */
export function getDegradedModels(): DegradedModel[] {
  return Array.from(degradedModels.values());
}

/** Reset all degraded state (primarily for tests). */
export function resetAllDegraded(): void {
  degradedModels.clear();
}
