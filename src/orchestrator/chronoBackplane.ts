import * as df from 'durable-functions';
import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';
import { trackEvent } from '../observability/telemetry.js';

const CHRONO_CONTAINER = 'chronoBackplane';
const CHRONO_TTL_SECONDS = 7 * 24 * 60 * 60;

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

export type ChronoContinuityDocument = z.infer<typeof ChronoContinuityDocumentSchema>;
export type ChronoInterruptionBreadcrumb = z.infer<typeof ChronoInterruptionBreadcrumbSchema>;
export type SaveChronoContinuityInput = z.infer<typeof SaveChronoContinuityInputSchema>;
export type SaveChronoInterruptionBreadcrumbInput = z.infer<typeof SaveChronoInterruptionBreadcrumbInputSchema>;

function getContinuityDocumentId(userId: string): string {
  return `${userId}:continuity`;
}

function getInterruptionBreadcrumbId(userId: string): string {
  return `${userId}:interruption`;
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
    const doc = await saveChronoContinuity(input);
    trackEvent({
      name: 'ChronoBackplaneWritten',
      correlationId: input.correlationId,
      userId: input.userId,
      properties: {
        type: doc.type,
        intention: doc.intention,
      },
    });
  },
});