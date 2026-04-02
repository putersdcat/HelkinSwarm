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

export const SaveChronoContinuityInputSchema = z.object({
  userId: z.string(),
  correlationId: z.string(),
  userMessage: z.string(),
  assistantReply: z.string(),
});

export type ChronoContinuityDocument = z.infer<typeof ChronoContinuityDocumentSchema>;
export type SaveChronoContinuityInput = z.infer<typeof SaveChronoContinuityInputSchema>;

function getContinuityDocumentId(userId: string): string {
  return `${userId}:continuity`;
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