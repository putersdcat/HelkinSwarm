import { describe, expect, it } from 'vitest';
import { getTraceTree } from '../../src/observability/sessionTracer.js';
import { buildSteeringInjection, recordSteeringInjection } from '../../src/orchestrator/steeringInjectionActivity.js';

describe('steering injection activity', () => {
  it('injects continuity cues when summary/history/quoted context are present', () => {
    const result = buildSteeringInjection({
      state: {
        userId: 'u1',
        userAlias: 'User',
        conversationId: 'conv',
        summary: 'The user was debugging hook delivery.',
        turnCount: 1,
        latestPromptTokens: 0,
        accumulatedTokens: 0,
        model: 'gpt-5.4-mini',
        totalTokens: 0,
        maxTokens: 128000,
        pendingHooks: [],
        safetyMode: 'confirmation-gated',
        euResidencyMode: false,
        recentHistory: [{ role: 'assistant', content: 'We were investigating the previous failure.' }],
      },
      userMessage: 'Continue',
      correlationId: 'corr-steering-1',
      chronoIntention: 'Continue debugging hook delivery.',
      quotedContext: { text: 'Previous hook result', mayBeTruncated: false },
    });

    expect(result.applied).toBe(true);
    expect(result.injectionBlock).toContain('[Steering Injection]');
    expect(result.injectionBlock).toContain('You previously planned to address: Continue debugging hook delivery.');
    expect(result.injectionBlock).toContain('quoted material as active continuity context');
    expect(result.injectionBlock).toContain('carried session summary');
  });

  it('records telemetry when steering injection is evaluated', async () => {
    const correlationId = 'corr-steering-2';
    const result = await recordSteeringInjection({
      state: {
        userId: 'u1',
        userAlias: 'User',
        conversationId: 'conv',
        summary: '',
        turnCount: 0,
        latestPromptTokens: 0,
        accumulatedTokens: 0,
        model: 'gpt-5.4-mini',
        totalTokens: 0,
        maxTokens: 128000,
        pendingHooks: [],
        safetyMode: 'confirmation-gated',
        euResidencyMode: false,
        recentHistory: [],
      },
      userMessage: 'Hello',
      correlationId,
      devLoopContext: { isDevLoop: true, prefix: 'DEVLOOP', correlationTag: null, body: 'Hello', hasOver: false },
    });

    expect(result.applied).toBe(true);
    const trace = getTraceTree(correlationId);
    const phase = trace?.phases.find((p) => p.name === 'SteeringInjectionApplied');
    const chronoPhase = trace?.phases.find((p) => p.name === 'ChronoBackplaneRead');
    expect(chronoPhase?.detail).toContain('type:');
    expect(phase?.detail).toContain('reason:');
  });
});