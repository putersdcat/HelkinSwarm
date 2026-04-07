import { describe, expect, it } from 'vitest';
import { extractFailoverStepsFromTraceTree } from '../../src/orchestrator/failoverNoticeRecovery.js';

describe('failoverNoticeRecovery', () => {
  it('reconstructs failover steps from trace detail for user-visible notice recovery', () => {
    const steps = extractFailoverStepsFromTraceTree({
      phases: [
        {
          id: 'phase-1',
          name: 'LlmFallbackTriggered',
          type: 'llm-call',
          startedAt: 0,
          durationMs: 0,
          status: 'completed',
          children: [],
          detail: 'originalModel: o4-mini, fallbackModel: o4-mini, reason: HTTP 503',
        },
      ],
    });

    expect(steps).toEqual([
      {
        fromModel: 'o4-mini',
        toModel: 'o4-mini',
        reason: 'HTTP 503',
        statusCode: 503,
      },
    ]);
  });

  it('walks nested trace phases when fallback telemetry is attached under child nodes', () => {
    const steps = extractFailoverStepsFromTraceTree({
      phases: [
        {
          id: 'root',
          name: 'PromptBuilt',
          type: 'prompt-build',
          startedAt: 0,
          durationMs: 0,
          status: 'completed',
          detail: 'PromptBuilt',
          children: [
            {
              id: 'child',
              name: 'LlmFallbackTriggered',
              type: 'llm-call',
              startedAt: 10,
              durationMs: 0,
              status: 'completed',
              children: [],
              detail: 'originalModel: grok-4-1-fast-non-reasoning, fallbackModel: FW-Kimi-K2.5, reason: HTTP 429',
            },
          ],
        },
      ],
    });

    expect(steps).toEqual([
      {
        fromModel: 'grok-4-1-fast-non-reasoning',
        toModel: 'FW-Kimi-K2.5',
        reason: 'HTTP 429',
        statusCode: 429,
      },
    ]);
  });
});