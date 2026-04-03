import { OrchestrationRuntimeStatus, type DurableClient } from 'durable-functions';
import { getActiveTurnStagesForUser, type ActiveTurnStage } from '../observability/orchestratorStageHealth.js';
import type { MindSessionGuardState } from './mindSessionGuard.js';
import { readMindSessionGuardState } from './mindSessionGuard.js';

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

function isActiveOverseerStatus(
  status: MinimalOrchestrationStatus,
  userId: string,
): boolean {
  if (!status.instanceId || !matchesOverseerIdentity(status.instanceId, userId)) {
    return false;
  }

  return status.runtimeStatus != null && ACTIVE_STATUSES.has(status.runtimeStatus);
}

export interface ActiveOverseerSummary {
  activeCount: number;
  latestInstanceId?: string;
}

export function summarizeRoutableOverseerInstances(
  statuses: ReadonlyArray<MinimalOrchestrationStatus>,
  userId: string,
  activeTurnEntries: ReadonlyArray<ActiveTurnStage>,
  guardState?: MindSessionGuardState,
): ActiveOverseerSummary {
  const activeTurnCount = activeTurnEntries.length;
  if (activeTurnCount <= 0) {
    return { activeCount: 0, latestInstanceId: undefined };
  }

  if (guardState?.activeInstanceId) {
    return {
      activeCount: 1,
      latestInstanceId: guardState.activeInstanceId,
    };
  }

  const stageBoundInstanceId = activeTurnEntries
    .filter((entry) => entry.instanceId !== undefined)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0]?.instanceId;

  if (stageBoundInstanceId) {
    return {
      activeCount: activeTurnCount,
      latestInstanceId: stageBoundInstanceId,
    };
  }

  return summarizeActiveOverseerInstances(statuses, userId);
}

export function summarizeActiveOverseerInstances(
  statuses: ReadonlyArray<MinimalOrchestrationStatus>,
  userId: string,
): ActiveOverseerSummary {
  const active = statuses.filter((status) => isActiveOverseerStatus(status, userId));
  const latestInstanceId = active
    .sort((left, right) => toEpochMs(right.createdTime) - toEpochMs(left.createdTime))[0]?.instanceId;

  return {
    activeCount: active.length,
    latestInstanceId,
  };
}

export function findActiveOverseerInstanceId(
  statuses: ReadonlyArray<MinimalOrchestrationStatus>,
  userId: string,
): string | undefined {
  return summarizeActiveOverseerInstances(statuses, userId).latestInstanceId;
}

export async function resolveActiveOverseerInstanceId(
  client: DurableClient,
  userId: string,
): Promise<string | undefined> {
  const [statuses, guardState, activeTurnEntries] = await Promise.all([
    client.getStatusAll(),
    readMindSessionGuardState(client, userId),
    getActiveTurnStagesForUser(userId),
  ]);

  return summarizeRoutableOverseerInstances(statuses, userId, activeTurnEntries, guardState).latestInstanceId;
}

export async function resolveActiveOverseerSummary(
  client: DurableClient,
  userId: string,
): Promise<ActiveOverseerSummary> {
  const [statuses, guardState, activeTurnEntries] = await Promise.all([
    client.getStatusAll(),
    readMindSessionGuardState(client, userId),
    getActiveTurnStagesForUser(userId),
  ]);

  return summarizeRoutableOverseerInstances(statuses, userId, activeTurnEntries, guardState);
}