import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('chrono backplane routing source guards', () => {
  it('registers the chrono seam and wires turn-write plus steering-read integration', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');
    const steeringSource = readFileSync('src/orchestrator/steeringInjectionActivity.ts', 'utf8');

    expect(botSource).toContain('saveChronoInterruptionBreadcrumb({');
    expect(botSource).toContain('saveChronoPausedTask({');
    expect(replaySource).toContain('saveChronoInterruptionBreadcrumb({');
    expect(replaySource).toContain('saveChronoPausedTask({');
    expect(steeringSource).toContain('loadChronoPausedTask,');
    expect(steeringSource).toContain('markChronoPausedTaskResumed,');
    expect(steeringSource).toContain('chronoContinuity = await loadChronoContinuity(input.state.userId);');
    expect(steeringSource).toContain('interruptionBreadcrumb = await loadChronoInterruptionBreadcrumb(input.state.userId, input.correlationId);');
    expect(steeringSource).toContain('pausedTask = await loadChronoPausedTask(input.state.userId, input.correlationId);');
    expect(steeringSource).toContain('await markChronoPausedTaskResumed(input.state.userId, input.correlationId);');
    expect(steeringSource).toContain("name: 'ChronoBackplaneRead'");
    expect(steeringSource).toContain("name: 'InterruptionBreadcrumbRead'");
    expect(steeringSource).toContain("name: 'PausedTaskResumeInjected'");
  });
});