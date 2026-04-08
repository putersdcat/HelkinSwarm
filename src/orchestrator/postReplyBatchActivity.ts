// Batched post-reply activity — runs storeMemory, saveState, and saveChronoContinuity
// in PARALLEL inside a single Durable activity call.
// This reduces Durable yields from 6+ (3 sequential activities × 2 yields each)
// to 2 (1 activity + 1 timer), dramatically improving buffered ingress turnaround time
// on Azure Storage backend where each yield costs ~5-10s in polling + replay overhead.
// Issue context: #595 Phase A post-turn bottleneck

import * as df from 'durable-functions';
import { z } from 'zod';
import { MemoryManager } from '../memory/memoryManager.js';
import { saveState } from './stateManager.js';
import { saveChronoContinuity } from './chronoBackplane.js';
import { recordSubstage } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';
import type { OverseerState } from './stateManager.js';
import type { SaveChronoContinuityInput } from './chronoBackplane.js';

const BATCH_TIMEOUT_MS = 12_000;

export const PostReplyBatchInputSchema = z.object({
  userId: z.string().min(1),
  correlationId: z.string().min(1),
  userMessage: z.string(),
  assistantReply: z.string(),
  state: z.record(z.unknown()),
});

export interface PostReplyBatchInput {
  userId: string;
  correlationId: string;
  userMessage: string;
  assistantReply: string;
  state: OverseerState;
}

export interface PostReplyBatchResult {
  memoryStored: boolean;
  stateSaved: boolean;
  chronoSaved: boolean;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
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

df.app.activity('postReplyBatchActivity', {
  handler: async (rawInput: unknown): Promise<PostReplyBatchResult> => {
    const input = PostReplyBatchInputSchema.parse(rawInput);
    const state = input.state as OverseerState;

    recordSubstage(input.correlationId, 'post-reply-batch', input.userId);

    const results = await Promise.allSettled([
      // 1. Store memory
      withTimeout(
        (async () => {
          const mm = new MemoryManager(input.userId);
          await mm.storeConversationTurn(input.userMessage, input.assistantReply);
          return true;
        })(),
        BATCH_TIMEOUT_MS,
        'storeMemory',
      ),
      // 2. Save state
      withTimeout(
        saveState(state),
        BATCH_TIMEOUT_MS,
        'saveState',
      ),
      // 3. Save chrono continuity
      withTimeout(
        saveChronoContinuity({
          userId: input.userId,
          correlationId: input.correlationId,
          userMessage: input.userMessage,
          assistantReply: input.assistantReply,
        } satisfies SaveChronoContinuityInput),
        BATCH_TIMEOUT_MS,
        'saveChronoContinuity',
      ),
    ]);

    const memoryStored = results[0].status === 'fulfilled';
    const stateSaved = results[1].status === 'fulfilled';
    const chronoSaved = results[2].status === 'fulfilled';

    for (const [i, r] of results.entries()) {
      if (r.status === 'rejected') {
        const labels = ['storeMemory', 'saveState', 'saveChronoContinuity'];
        console.warn(
          `[postReplyBatchActivity] ${labels[i]} failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`,
        );
      }
    }

    trackEvent({
      name: 'PostReplyBatchCompleted',
      correlationId: input.correlationId,
      userId: input.userId,
      properties: { memoryStored, stateSaved, chronoSaved },
    });

    return { memoryStored, stateSaved, chronoSaved };
  },
});
