import { OrchestrationRuntimeStatus, type DurableClient } from 'durable-functions';

export interface MinimalOrchestrationStatus {
  instanceId?: string;
  runtimeStatus?: OrchestrationRuntimeStatus | null;
  createdTime?: Date | string;
}

const ACTIVE_STATUSES = new Set<OrchestrationRuntimeStatus>([
  OrchestrationRuntimeStatus.Running,
  OrchestrationRuntimeStatus.Pending,
  OrchestrationRuntimeStatus.ContinuedAsNew,
]);

function toEpochMs(value: Date | string | undefined): number {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function matchesOverseerIdentity(instanceId: string, userId: string): boolean {
  return instanceId === `overseer-${userId}` || instanceId.startsWith(`overseer-${userId}-`);
}

export function findActiveOverseerInstanceId(
  statuses: ReadonlyArray<MinimalOrchestrationStatus>,
  userId: string,
): string | undefined {
  return statuses
    .filter((status) => {
      if (!status.instanceId || !matchesOverseerIdentity(status.instanceId, userId)) {
        return false;
      }

      return status.runtimeStatus != null && ACTIVE_STATUSES.has(status.runtimeStatus);
    })
    .sort((left, right) => toEpochMs(right.createdTime) - toEpochMs(left.createdTime))[0]?.instanceId;
}

export async function resolveActiveOverseerInstanceId(
  client: DurableClient,
  userId: string,
): Promise<string | undefined> {
  const statuses = await client.getStatusAll();
  return findActiveOverseerInstanceId(statuses, userId);
}