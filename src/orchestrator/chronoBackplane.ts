import * as df from 'durable-functions';
import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';
import { trackEvent } from '../observability/telemetry.js';

const CHRONO_CONTAINER = 'chronoBackplane';
const CHRONO_TTL_SECONDS = 7 * 24 * 60 * 60;
const CHRONO_ACTIVITY_TIMEOUT_MS = 5_000;

async function withActivityTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`chrono activity timed out after ${timeoutMs}ms`);
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

export const ChronoContinuityDocumentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.literal('continuity-intention'),
  intention: z.string(),
  anchorUserMessage: z.string(),
  anchorAssistantReply: z.string(),
  anchorCorrelationId: z.string(),
  updatedAt: z.string(),
  ttl: z.number().int().positive(),
});

export const ChronoInterruptionBreadcrumbSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.literal('interruption-breadcrumb'),
  interruptedInstanceId: z.string(),
  interruptedCorrelationId: z.string().optional(),
  interruptedSource: z.string().optional(),
  interruptedByCorrelationId: z.string(),
  interruptedByMessage: z.string(),
  updatedAt: z.string(),
  ttl: z.number().int().positive(),
});

export const ChronoScheduledWakeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.literal('scheduled-wake'),
  wakeAt: z.string(),
  wakeMessage: z.string(),
  registrationCorrelationId: z.string(),
  conversationReferenceJson: z.string().optional(),
  status: z.enum(['scheduled', 'dispatched', 'cancelled']).default('scheduled'),
  dispatchedAt: z.string().optional(),
  dispatchedCorrelationId: z.string().optional(),
  deferredAt: z.string().optional(),
  deferredReason: z.string().optional(),
  deferCount: z.number().int().nonnegative().optional(),
  updatedAt: z.string(),
  ttl: z.number().int().positive(),
});

export const ChronoPausedTaskSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.literal('paused-task'),
  interruptedInstanceId: z.string(),
  interruptedCorrelationId: z.string().optional(),
  interruptedSource: z.string().optional(),
  pausedByCorrelationId: z.string(),
  pausedByMessage: z.string(),
  resumePrompt: z.string(),
  status: z.enum(['paused', 'resumed']).default('paused'),
  resumedByCorrelationId: z.string().optional(),
  resumedAt: z.string().optional(),
  updatedAt: z.string(),
  ttl: z.number().int().positive(),
});

export const SaveChronoContinuityInputSchema = z.object({
  userId: z.string(),
  correlationId: z.string(),
  userMessage: z.string(),
  assistantReply: z.string(),
});

export const SaveChronoInterruptionBreadcrumbInputSchema = z.object({
  userId: z.string(),
  interruptedInstanceId: z.string(),
  interruptedCorrelationId: z.string().optional(),
  interruptedSource: z.string().optional(),
  interruptedByCorrelationId: z.string(),
  interruptedByMessage: z.string(),
});

export const SaveChronoScheduledWakeInputSchema = z.object({
  userId: z.string(),
  wakeAt: z.string(),
  wakeMessage: z.string(),
  registrationCorrelationId: z.string(),
  conversationReferenceJson: z.string().optional(),
});

export const SaveChronoPausedTaskInputSchema = z.object({
  userId: z.string(),
  interruptedInstanceId: z.string(),
  interruptedCorrelationId: z.string().optional(),
  interruptedSource: z.string().optional(),
  pausedByCorrelationId: z.string(),
  pausedByMessage: z.string(),
});

export type ChronoContinuityDocument = z.infer<typeof ChronoContinuityDocumentSchema>;
export type ChronoInterruptionBreadcrumb = z.infer<typeof ChronoInterruptionBreadcrumbSchema>;
export type ChronoScheduledWake = z.infer<typeof ChronoScheduledWakeSchema>;
export type ChronoPausedTask = z.infer<typeof ChronoPausedTaskSchema>;
export type SaveChronoContinuityInput = z.infer<typeof SaveChronoContinuityInputSchema>;
export type SaveChronoInterruptionBreadcrumbInput = z.infer<typeof SaveChronoInterruptionBreadcrumbInputSchema>;
export type SaveChronoScheduledWakeInput = z.infer<typeof SaveChronoScheduledWakeInputSchema>;
export type SaveChronoPausedTaskInput = z.infer<typeof SaveChronoPausedTaskInputSchema>;

function getContinuityDocumentId(userId: string): string {
  return `${userId}:continuity`;
}

function getInterruptionBreadcrumbId(userId: string): string {
  return `${userId}:interruption`;
}

function getScheduledWakeDocumentId(userId: string, wakeId: string): string {
  return `${userId}:wake:${wakeId}`;
}

function getPausedTaskDocumentId(userId: string): string {
  return `${userId}:paused-task`;
}

function summarizeForChrono(text: string, maxLength = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function buildChronoContinuityDocument(input: SaveChronoContinuityInput): ChronoContinuityDocument {
  const parsed = SaveChronoContinuityInputSchema.parse(input);
  return ChronoContinuityDocumentSchema.parse({
    id: getContinuityDocumentId(parsed.userId),
    userId: parsed.userId,
    type: 'continuity-intention',
    intention: summarizeForChrono(parsed.userMessage),
    anchorUserMessage: summarizeForChrono(parsed.userMessage, 400),
    anchorAssistantReply: summarizeForChrono(parsed.assistantReply, 400),
    anchorCorrelationId: parsed.correlationId,
    updatedAt: new Date().toISOString(),
    ttl: CHRONO_TTL_SECONDS,
  });
}

export function buildChronoInterruptionBreadcrumb(
  input: SaveChronoInterruptionBreadcrumbInput,
): ChronoInterruptionBreadcrumb {
  const parsed = SaveChronoInterruptionBreadcrumbInputSchema.parse(input);
  return ChronoInterruptionBreadcrumbSchema.parse({
    id: getInterruptionBreadcrumbId(parsed.userId),
    userId: parsed.userId,
    type: 'interruption-breadcrumb',
    interruptedInstanceId: parsed.interruptedInstanceId,
    interruptedCorrelationId: parsed.interruptedCorrelationId,
    interruptedSource: parsed.interruptedSource,
    interruptedByCorrelationId: parsed.interruptedByCorrelationId,
    interruptedByMessage: summarizeForChrono(parsed.interruptedByMessage, 400),
    updatedAt: new Date().toISOString(),
    ttl: CHRONO_TTL_SECONDS,
  });
}

export function buildChronoScheduledWake(input: SaveChronoScheduledWakeInput): ChronoScheduledWake {
  const parsed = SaveChronoScheduledWakeInputSchema.parse(input);
  const wakeId = crypto.randomUUID();
  return ChronoScheduledWakeSchema.parse({
    id: getScheduledWakeDocumentId(parsed.userId, wakeId),
    userId: parsed.userId,
    type: 'scheduled-wake',
    wakeAt: parsed.wakeAt,
    wakeMessage: summarizeForChrono(parsed.wakeMessage, 400),
    registrationCorrelationId: parsed.registrationCorrelationId,
    conversationReferenceJson: parsed.conversationReferenceJson,
    status: 'scheduled',
    updatedAt: new Date().toISOString(),
    ttl: CHRONO_TTL_SECONDS,
  });
}

export function buildChronoPausedTask(input: SaveChronoPausedTaskInput): ChronoPausedTask {
  const parsed = SaveChronoPausedTaskInputSchema.parse(input);
  const interruptedReference = parsed.interruptedCorrelationId ?? `instance ${parsed.interruptedInstanceId}`;

  return ChronoPausedTaskSchema.parse({
    id: getPausedTaskDocumentId(parsed.userId),
    userId: parsed.userId,
    type: 'paused-task',
    interruptedInstanceId: parsed.interruptedInstanceId,
    interruptedCorrelationId: parsed.interruptedCorrelationId,
    interruptedSource: parsed.interruptedSource,
    pausedByCorrelationId: parsed.pausedByCorrelationId,
    pausedByMessage: summarizeForChrono(parsed.pausedByMessage, 400),
    resumePrompt: summarizeForChrono(
      `Resume the displaced task from ${interruptedReference}. It was interrupted by: ${parsed.pausedByMessage}`,
      400,
    ),
    status: 'paused',
    updatedAt: new Date().toISOString(),
    ttl: CHRONO_TTL_SECONDS,
  });
}

export async function saveChronoContinuity(input: SaveChronoContinuityInput): Promise<ChronoContinuityDocument> {
  const doc = buildChronoContinuityDocument(input);
  await getContainer(CHRONO_CONTAINER).items.upsert(doc);
  return doc;
}

export async function loadChronoContinuity(userId: string): Promise<ChronoContinuityDocument | undefined> {
  try {
    const { resource } = await getContainer(CHRONO_CONTAINER)
      .item(getContinuityDocumentId(userId), userId)
      .read<ChronoContinuityDocument>();
    if (!resource) {
      return undefined;
    }

    return ChronoContinuityDocumentSchema.parse(resource);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function saveChronoInterruptionBreadcrumb(
  input: SaveChronoInterruptionBreadcrumbInput,
): Promise<ChronoInterruptionBreadcrumb> {
  const doc = buildChronoInterruptionBreadcrumb(input);
  await getContainer(CHRONO_CONTAINER).items.upsert(doc);
  trackEvent({
    name: 'InterruptionBreadcrumbWritten',
    correlationId: input.interruptedByCorrelationId,
    userId: input.userId,
    properties: {
      interruptedInstanceId: doc.interruptedInstanceId,
      interruptedCorrelationId: doc.interruptedCorrelationId ?? 'none',
      interruptedSource: doc.interruptedSource ?? 'unknown',
      type: doc.type,
    },
  });
  return doc;
}

export async function saveChronoScheduledWake(
  input: SaveChronoScheduledWakeInput,
): Promise<ChronoScheduledWake> {
  const doc = buildChronoScheduledWake(input);
  await getContainer(CHRONO_CONTAINER).items.upsert(doc);
  return doc;
}

export async function saveChronoPausedTask(
  input: SaveChronoPausedTaskInput,
): Promise<ChronoPausedTask> {
  const doc = buildChronoPausedTask(input);
  await getContainer(CHRONO_CONTAINER).items.upsert(doc);
  trackEvent({
    name: 'PausedTaskPaged',
    correlationId: input.pausedByCorrelationId,
    userId: input.userId,
    properties: {
      pausedTaskId: doc.id,
      interruptedInstanceId: doc.interruptedInstanceId,
      interruptedCorrelationId: doc.interruptedCorrelationId ?? 'none',
      interruptedSource: doc.interruptedSource ?? 'unknown',
    },
  });
  return doc;
}

export async function listDueChronoScheduledWakes(
  nowIso = new Date().toISOString(),
  limit = 20,
): Promise<ChronoScheduledWake[]> {
  const query = {
    query: `SELECT TOP @limit * FROM c WHERE c.type = 'scheduled-wake' AND c.status = 'scheduled' AND c.wakeAt <= @now ORDER BY c.wakeAt ASC`,
    parameters: [
      { name: '@now', value: nowIso },
      { name: '@limit', value: limit },
    ],
  };

  const { resources } = await getContainer(CHRONO_CONTAINER).items.query<ChronoScheduledWake>(query).fetchAll();
  return resources.map((resource) => ChronoScheduledWakeSchema.parse(resource));
}

export async function markChronoScheduledWakeDispatched(
  wakeId: string,
  userId: string,
  dispatchedCorrelationId: string,
): Promise<void> {
  await getContainer(CHRONO_CONTAINER).item(wakeId, userId).patch([
    { op: 'replace', path: '/status', value: 'dispatched' },
    { op: 'replace', path: '/updatedAt', value: new Date().toISOString() },
    { op: 'add', path: '/dispatchedAt', value: new Date().toISOString() },
    { op: 'add', path: '/dispatchedCorrelationId', value: dispatchedCorrelationId },
  ]);
}

export async function deferChronoScheduledWake(
  wakeId: string,
  userId: string,
  nextWakeAt: string,
  reason: string,
): Promise<void> {
  const container = getContainer(CHRONO_CONTAINER);
  const { resource } = await container.item(wakeId, userId).read<ChronoScheduledWake>();
  if (!resource) {
    return;
  }

  const existingDeferCount = resource.deferCount ?? 0;
  const nextDoc = ChronoScheduledWakeSchema.parse({
    ...resource,
    wakeAt: nextWakeAt,
    deferredAt: new Date().toISOString(),
    deferredReason: reason,
    deferCount: existingDeferCount + 1,
    updatedAt: new Date().toISOString(),
  });

  await container.item(wakeId, userId).replace(nextDoc);
}

export async function loadChronoPausedTask(
  userId: string,
  correlationId: string,
): Promise<ChronoPausedTask | undefined> {
  try {
    const { resource } = await getContainer(CHRONO_CONTAINER)
      .item(getPausedTaskDocumentId(userId), userId)
      .read<ChronoPausedTask>();
    if (!resource) {
      return undefined;
    }

    const parsed = ChronoPausedTaskSchema.parse(resource);
    if (parsed.status !== 'paused' || parsed.pausedByCorrelationId === correlationId) {
      return undefined;
    }

    return parsed;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function markChronoPausedTaskResumed(
  userId: string,
  resumedByCorrelationId: string,
): Promise<void> {
  await getContainer(CHRONO_CONTAINER).item(getPausedTaskDocumentId(userId), userId).patch([
    { op: 'replace', path: '/status', value: 'resumed' },
    { op: 'replace', path: '/updatedAt', value: new Date().toISOString() },
    { op: 'add', path: '/resumedAt', value: new Date().toISOString() },
    { op: 'add', path: '/resumedByCorrelationId', value: resumedByCorrelationId },
  ]);
}

export async function loadChronoInterruptionBreadcrumb(
  userId: string,
  correlationId: string,
): Promise<ChronoInterruptionBreadcrumb | undefined> {
  try {
    const { resource } = await getContainer(CHRONO_CONTAINER)
      .item(getInterruptionBreadcrumbId(userId), userId)
      .read<ChronoInterruptionBreadcrumb>();
    if (!resource) {
      return undefined;
    }

    const parsed = ChronoInterruptionBreadcrumbSchema.parse(resource);
    if (parsed.interruptedByCorrelationId !== correlationId) {
      return undefined;
    }

    return parsed;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return undefined;
    }
    throw err;
  }
}

df.app.activity('saveChronoContinuityActivity', {
  handler: async (rawInput: unknown): Promise<void> => {
    const input = SaveChronoContinuityInputSchema.parse(rawInput);
    try {
      const doc = await withActivityTimeout(saveChronoContinuity(input), CHRONO_ACTIVITY_TIMEOUT_MS);
      trackEvent({
        name: 'ChronoBackplaneWritten',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          type: doc.type,
          intention: doc.intention,
        },
      });
    } catch (err) {
      console.warn(
        `[saveChronoContinuityActivity] Skipping chrono persistence after timeout/error: ${err instanceof Error ? err.message : err}`,
      );
    }
  },
});