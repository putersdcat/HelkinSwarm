// Hook Resolution Activity — processes a fired hook event, runs fuzzy matching,
// and creates tentative actions if the match is positive.
// Called by the overseer when a HookFired external event is received.
// Spec ref: 0h-Long-Running-Workflows.md §5 (Workflow Engine), Issue #74

import * as df from 'durable-functions';
import { z } from 'zod';
import { getHookById } from './hookCatalog.js';
import { fuzzyMatch } from './fuzzyMatcher.js';
import { createTentativeAction } from './tentativeActions.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const HookFiredInputSchema = z.object({
  hookId: z.string(),
  userId: z.string(),
  correlationId: z.string(),
  payload: z.object({
    sender: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    changeType: z.string().optional(),
    resource: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  suggestedActions: z.array(z.object({
    actionType: z.enum([
      'calendar_create', 'calendar_update', 'email_reply',
      'booking_confirm', 'payment_authorize', 'custom',
    ]),
    summary: z.string(),
    details: z.record(z.unknown()),
  })).optional(),
});

// inferred input type used by Durable activity runtime

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

interface HookResolutionResult {
  hookId: string;
  matched: boolean;
  confidence: number;
  matchDetails: string;
  tentativeActions: Array<{ actionId: string; actionType: string; summary: string }>;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

df.app.activity('hookResolutionActivity', {
  handler: async (input: unknown): Promise<HookResolutionResult> => {
    const parsed = HookFiredInputSchema.parse(input);

    // Retrieve hook to get expected patterns
    const hook = await getHookById(parsed.hookId, parsed.userId);
    if (!hook) {
      return {
        hookId: parsed.hookId,
        matched: false,
        confidence: 0,
        matchDetails: 'Hook not found',
        tentativeActions: [],
      };
    }

    // Run fuzzy matching if expected patterns are defined
    let matchResult = { matched: true, confidence: 1.0, matchedOn: [] as string[], details: 'No pattern specified — auto-match' };

    if (hook.expectedReplyPattern) {
      matchResult = fuzzyMatch({
        expected: hook.expectedReplyPattern,
        actual: {
          sender: parsed.payload.sender,
          subject: parsed.payload.subject,
          body: parsed.payload.body,
          metadata: parsed.payload.metadata,
        },
      });
    }

    trackEvent({
      name: 'DurableHookTriggered',
      correlationId: parsed.correlationId,
      userId: parsed.userId,
      properties: {
        hookId: parsed.hookId,
        matched: String(matchResult.matched),
        confidence: String(matchResult.confidence),
        matchedOn: matchResult.matchedOn.join(','),
      },
    });

    // If no match, skip tentative actions
    if (!matchResult.matched) {
      return {
        hookId: parsed.hookId,
        matched: false,
        confidence: matchResult.confidence,
        matchDetails: matchResult.details,
        tentativeActions: [],
      };
    }

    // Create tentative actions for each suggested action
    const tentativeActions: HookResolutionResult['tentativeActions'] = [];

    if (parsed.suggestedActions) {
      for (const suggested of parsed.suggestedActions) {
        const action = await createTentativeAction({
          userId: parsed.userId,
          hookId: parsed.hookId,
          correlationId: parsed.correlationId,
          actionType: suggested.actionType,
          summary: suggested.summary,
          details: suggested.details,
          ttlMinutes: 60,
        });

        tentativeActions.push({
          actionId: action.id,
          actionType: action.actionType,
          summary: action.summary,
        });
      }
    }

    return {
      hookId: parsed.hookId,
      matched: true,
      confidence: matchResult.confidence,
      matchDetails: matchResult.details,
      tentativeActions,
    };
  },
});
