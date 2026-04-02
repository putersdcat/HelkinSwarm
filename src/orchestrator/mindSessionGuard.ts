import * as df from 'durable-functions';
import { z } from 'zod';

export const MIND_SESSION_GUARD_ENTITY_NAME = 'mindSessionGuard';
export const MAX_INTERRUPTION_DEPTH = 3;

export const MindSessionGuardAcquireInputSchema = z.object({
  instanceId: z.string().min(1),
  correlationId: z.string().min(1),
  source: z.string().min(1),
});

export const MindSessionGuardReleaseInputSchema = z.object({
  instanceId: z.string().min(1),
  correlationId: z.string().min(1),
});

export const MindSessionGuardStateSchema = z.object({
  activeInstanceId: z.string().optional(),
  activeCorrelationId: z.string().optional(),
  activeSource: z.string().optional(),
  lastReleasedInstanceId: z.string().optional(),
  lastReleasedCorrelationId: z.string().optional(),
  updatedAt: z.string().optional(),
  acquisitionCount: z.number().int().nonnegative().default(0),
  collisionCount: z.number().int().nonnegative().default(0),
  interruptionDepth: z.number().int().nonnegative().default(0),
});

export type MindSessionGuardAcquireInput = z.infer<typeof MindSessionGuardAcquireInputSchema>;
export type MindSessionGuardReleaseInput = z.infer<typeof MindSessionGuardReleaseInputSchema>;
export type MindSessionGuardState = z.infer<typeof MindSessionGuardStateSchema>;

export function applyMindSessionAcquire(
  state: MindSessionGuardState,
  input: MindSessionGuardAcquireInput,
): MindSessionGuardState {
  const collision = state.activeInstanceId !== undefined && state.activeInstanceId !== input.instanceId;
  return MindSessionGuardStateSchema.parse({
    ...state,
    activeInstanceId: input.instanceId,
    activeCorrelationId: input.correlationId,
    activeSource: input.source,
    updatedAt: new Date().toISOString(),
    acquisitionCount: state.acquisitionCount + 1,
    collisionCount: collision ? state.collisionCount + 1 : state.collisionCount,
    interruptionDepth: collision ? state.interruptionDepth + 1 : state.interruptionDepth,
  });
}

export function applyMindSessionRelease(
  state: MindSessionGuardState,
  input: MindSessionGuardReleaseInput,
): MindSessionGuardState {
  if (state.activeInstanceId !== input.instanceId) {
    return state;
  }

  return MindSessionGuardStateSchema.parse({
    ...state,
    activeInstanceId: undefined,
    activeCorrelationId: undefined,
    activeSource: undefined,
    lastReleasedInstanceId: input.instanceId,
    lastReleasedCorrelationId: input.correlationId,
    updatedAt: new Date().toISOString(),
    interruptionDepth: 0,
  });
}

export function hasReachedInterruptionDepthCap(
  state: MindSessionGuardState | undefined,
  cap = MAX_INTERRUPTION_DEPTH,
): boolean {
  return (state?.activeInstanceId !== undefined) && ((state.interruptionDepth ?? 0) >= cap);
}

export function getMindSessionGuardEntityId(userId: string): df.EntityId {
  return new df.EntityId(MIND_SESSION_GUARD_ENTITY_NAME, userId);
}

export async function readMindSessionGuardState(
  client: df.DurableClient,
  userId: string,
): Promise<MindSessionGuardState | undefined> {
  const response = await client.readEntityState<MindSessionGuardState>(getMindSessionGuardEntityId(userId));
  if (!response.entityExists) {
    return undefined;
  }

  return MindSessionGuardStateSchema.parse(response.entityState ?? {});
}

export async function signalMindSessionAcquire(
  client: df.DurableClient,
  userId: string,
  input: MindSessionGuardAcquireInput,
): Promise<void> {
  await client.signalEntity(
    getMindSessionGuardEntityId(userId),
    'acquire',
    MindSessionGuardAcquireInputSchema.parse(input),
  );
}

export async function signalMindSessionRelease(
  client: df.DurableClient,
  userId: string,
  input: MindSessionGuardReleaseInput,
): Promise<void> {
  await client.signalEntity(
    getMindSessionGuardEntityId(userId),
    'release',
    MindSessionGuardReleaseInputSchema.parse(input),
  );
}

df.app.entity(MIND_SESSION_GUARD_ENTITY_NAME, (context) => {
  const current = MindSessionGuardStateSchema.parse(
    context.df.getState(() => ({ acquisitionCount: 0, collisionCount: 0, interruptionDepth: 0 })),
  );

  switch (context.df.operationName) {
    case 'acquire': {
      const input = MindSessionGuardAcquireInputSchema.parse(context.df.getInput());
      context.df.setState(applyMindSessionAcquire(current, input));
      return;
    }
    case 'release': {
      const input = MindSessionGuardReleaseInputSchema.parse(context.df.getInput());
      context.df.setState(applyMindSessionRelease(current, input));
      return;
    }
    case 'get':
      context.df.return(current);
      return;
    case 'reset':
      context.df.setState({ acquisitionCount: 0, collisionCount: 0, interruptionDepth: 0 } satisfies MindSessionGuardState);
      return;
    default:
      return;
  }
});