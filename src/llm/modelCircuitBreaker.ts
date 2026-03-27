// Model circuit breaker — tracks degraded models and skips them during fallback.
// In-memory state; resets on Function App cold start (by design — #152).

export interface DegradedModel {
  deploymentName: string;
  degradedAt: number;
  reason: string;
  failureCount: number;
  cooldownMs: number; // differentiated by error type (#313)
}

const DEFAULT_COOLDOWN_MS = 60_000; // 60 seconds

/**
 * Compute the cooldown duration for a degraded model based on failure type and history.
 * 429 (quota) gets an escalating window; transient errors use shorter fixed values.
 * (#313)
 */
export function getCooldownForReason(reason: string, failureCount: number): number {
  if (reason.includes('429')) {
    // Quota exhausted — escalating backoff: 5m, 10m, 15m (cap)
    const baseMs = 5 * 60_000;
    const cap = 15 * 60_000;
    return Math.min(baseMs * failureCount, cap);
  }
  if (reason.includes('503') || reason.includes('504')) {
    return 2 * 60_000; // 2 minutes for service-unavailable
  }
  if (reason === 'timeout') {
    return 90_000; // 90 seconds for timeouts
  }
  return DEFAULT_COOLDOWN_MS;
}

/** In-memory degraded model registry. */
const degradedModels = new Map<string, DegradedModel>();

/** Mark a model as degraded so subsequent requests skip it. */
export function markModelDegraded(deploymentName: string, reason: string, explicitCooldownMs?: number): void {
  const existing = degradedModels.get(deploymentName);
  const failureCount = (existing?.failureCount ?? 0) + 1;
  degradedModels.set(deploymentName, {
    deploymentName,
    degradedAt: Date.now(),
    reason,
    failureCount,
    cooldownMs: explicitCooldownMs ?? getCooldownForReason(reason, failureCount),
  });
}

/** Check whether a model is currently degraded (within cooldown).
 * When `cooldownMs` is provided it overrides the per-entry stored cooldown
 * (used in tests to simulate time passing). Otherwise the per-entry cooldown
 * determined at mark time is used, falling back to the 60s default. (#313)
 */
export function isModelDegraded(deploymentName: string, cooldownMs?: number): boolean {
  const entry = degradedModels.get(deploymentName);
  if (!entry) return false;

  const effectiveCooldown = cooldownMs ?? entry.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const elapsed = Date.now() - entry.degradedAt;
  if (elapsed >= effectiveCooldown) {
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
