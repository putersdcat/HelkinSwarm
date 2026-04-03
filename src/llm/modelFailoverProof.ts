export interface ForcedRetryableFailure {
  deploymentName: string;
  reason: string;
  statusCode: number;
  remainingAttempts: number;
}

const forcedRetryableFailures = new Map<string, ForcedRetryableFailure>();

export function seedForcedRetryableFailure(
  deploymentName: string,
  reason: string,
  statusCode: number,
  attemptCount = 1,
): void {
  forcedRetryableFailures.set(deploymentName, {
    deploymentName,
    reason,
    statusCode,
    remainingAttempts: attemptCount,
  });
}

export function consumeForcedRetryableFailure(deploymentName: string): ForcedRetryableFailure | undefined {
  const existing = forcedRetryableFailures.get(deploymentName);
  if (!existing) {
    return undefined;
  }

  const current = { ...existing };
  if (existing.remainingAttempts <= 1) {
    forcedRetryableFailures.delete(deploymentName);
  } else {
    forcedRetryableFailures.set(deploymentName, {
      ...existing,
      remainingAttempts: existing.remainingAttempts - 1,
    });
  }

  return current;
}

export function clearForcedRetryableFailure(deploymentName: string): void {
  forcedRetryableFailures.delete(deploymentName);
}

export function resetForcedRetryableFailures(): void {
  forcedRetryableFailures.clear();
}