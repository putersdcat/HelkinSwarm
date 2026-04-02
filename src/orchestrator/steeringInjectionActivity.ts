import * as df from 'durable-functions';
import { z } from 'zod';
import type { OverseerState } from './stateManager.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import type { QuotedContext } from '../bot/quotedContext.js';
import { loadChronoContinuity } from './chronoBackplane.js';
import { trackEvent } from '../observability/telemetry.js';

export const SteeringInjectionInputSchema = z.object({
  state: z.object({
    userId: z.string(),
    summary: z.string().default(''),
    recentHistory: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })).default([]),
    pendingClarification: z.object({
      id: z.string(),
      reason: z.string(),
    }).optional(),
  }),
  userMessage: z.string(),
  correlationId: z.string().min(1),
  quotedContext: z.object({
    text: z.string(),
    mayBeTruncated: z.boolean().optional(),
  }).optional(),
  devLoopContext: z.object({
    isDevLoop: z.boolean(),
  }).optional(),
});

export const SteeringInjectionResultSchema = z.object({
  applied: z.boolean(),
  reason: z.string(),
  injectionBlock: z.string(),
});

export const SteeringCueInputSchema = SteeringInjectionInputSchema.extend({
  chronoIntention: z.string().optional(),
});

export type SteeringInjectionInput = {
  state: OverseerState;
  userMessage: string;
  correlationId: string;
  quotedContext?: QuotedContext;
  devLoopContext?: DevLoopContext;
};

export type SteeringInjectionResult = z.infer<typeof SteeringInjectionResultSchema>;

export function buildSteeringInjection(
  rawInput: SteeringInjectionInput & { chronoIntention?: string },
): SteeringInjectionResult {
  const input = SteeringCueInputSchema.parse(rawInput);
  const cues: string[] = [];

  if (input.chronoIntention) {
    cues.push(`You previously planned to address: ${input.chronoIntention}`);
  }

  if (input.state.pendingClarification) {
    cues.push(
      `There is unfinished clarification context (${input.state.pendingClarification.reason}). Prefer continuity with that unresolved thread before branching to a new task.`,
    );
  }

  if (input.quotedContext?.text) {
    const truncation = input.quotedContext.mayBeTruncated ? ' The quoted text may be truncated.' : '';
    cues.push(
      `The user explicitly replied to earlier quoted content. Treat that quoted material as active continuity context, not as an unrelated fresh turn.${truncation}`,
    );
  }

  if (input.state.summary.trim().length > 0) {
    cues.push('Preserve continuity with the carried session summary when interpreting this turn.');
  }

  if (input.state.recentHistory.length > 0) {
    cues.push('Recent conversation history exists. Reconcile the new message against the active thread before pivoting away.');
  }

  if (input.devLoopContext?.isDevLoop) {
    cues.push('This is an active DevLoop session. Preserve the current debugging/interrogation thread unless the user clearly redirects it.');
  }

  if (cues.length === 0) {
    return SteeringInjectionResultSchema.parse({
      applied: false,
      reason: 'No steering cues were present for this session start.',
      injectionBlock: '',
    });
  }

  return SteeringInjectionResultSchema.parse({
    applied: true,
    reason: 'Session continuity cues were detected and injected before prompt assembly.',
    injectionBlock: `[Steering Injection]\n${cues.map((cue) => `- ${cue}`).join('\n')}`,
  });
}

export async function recordSteeringInjection(rawInput: SteeringInjectionInput): Promise<SteeringInjectionResult> {
  const input = SteeringInjectionInputSchema.parse(rawInput);
  let chronoContinuity;
  let chronoReadError: string | undefined;
  try {
    chronoContinuity = await loadChronoContinuity(input.state.userId);
  } catch (err) {
    chronoReadError = err instanceof Error ? err.message : String(err);
  }
  const chronoIntention = chronoContinuity && chronoContinuity.anchorCorrelationId !== input.correlationId
    ? chronoContinuity.intention
    : undefined;
  const result = buildSteeringInjection({ ...rawInput, chronoIntention });

  trackEvent({
    name: 'ChronoBackplaneRead',
    correlationId: input.correlationId,
    userId: input.state.userId,
    properties: {
      found: chronoContinuity !== undefined,
      injected: chronoIntention !== undefined,
      type: chronoContinuity?.type ?? 'none',
      ...(chronoReadError ? { error: chronoReadError } : {}),
    },
  });

  trackEvent({
    name: 'SteeringInjectionApplied',
    correlationId: input.correlationId,
    userId: input.state.userId,
    properties: {
      applied: result.applied,
      reason: result.reason,
      hasQuotedContext: input.quotedContext !== undefined,
      hasSummary: input.state.summary.trim().length > 0,
      recentHistoryCount: input.state.recentHistory.length,
      hasPendingClarification: input.state.pendingClarification !== undefined,
      hasChronoIntention: chronoIntention !== undefined,
      isDevLoop: input.devLoopContext?.isDevLoop ?? false,
    },
  });

  return result;
}

df.app.activity('steeringInjectionActivity', {
  handler: async (rawInput: unknown): Promise<SteeringInjectionResult> => {
    return await recordSteeringInjection(rawInput as SteeringInjectionInput);
  },
});