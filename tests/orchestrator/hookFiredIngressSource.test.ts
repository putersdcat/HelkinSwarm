import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('hook-fired ingress proof surface', () => {
  it('drains HookFired events through the living overseer ingress window', () => {
    const overseer = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const ingressStage = readFileSync('src/orchestrator/ingressWindowStageActivity.ts', 'utf8');
    const telemetry = readFileSync('src/observability/telemetry.ts', 'utf8');

    expect(overseer).toContain("const hookFiredEvent = context.df.waitForExternalEvent('HookFired');");
    expect(overseer).toContain("if (winner === hookFiredEvent) {");
    expect(overseer).toContain("action: 'hook-drain',");
    expect(overseer).toContain('userMessage: drainedHook.originalIntent,');

    expect(ingressStage).toContain("action: z.literal('hook-drain')");
    expect(ingressStage).toContain("name: 'LivingSessionHookDrained'");
    expect(ingressStage).toContain('hookId: input.hookId,');

    expect(telemetry).toContain("| 'LivingSessionHookDrained'");
    expect(telemetry).toContain("LivingSessionHookDrained: 'orchestrator'");
  });
});