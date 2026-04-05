import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('durable active overseer guard source guards', () => {
  it('requires Durable-backed active overseer evidence instead of stage-count-plus-guard fallback for ingress decisions', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const selfAwakenSource = readFileSync('src/functions/selfAwakenTimer.ts', 'utf8');
    const pendingIntentSource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');

    expect(botSource).toContain('const effectiveActiveInstanceId = activeSummary.latestInstanceId;');
    expect(botSource).toContain('const hasActiveGuard = activeSummary.activeCount > 0 && effectiveActiveInstanceId !== identity.instanceId;');
    expect(botSource).not.toContain('const effectiveActiveInstanceId = observedActiveInstanceId ?? (activeTurnCount > 0 ? guardState?.activeInstanceId : undefined);');

    expect(selfAwakenSource).toContain('const effectiveActiveInstanceId = activeSummary.latestInstanceId;');
    expect(selfAwakenSource).toContain('const hasActiveGuard = activeSummary.activeCount > 0 && effectiveActiveInstanceId !== undefined;');
    expect(selfAwakenSource).not.toContain('const effectiveActiveInstanceId = observedActiveInstanceId ?? (activeTurnCount > 0 ? guardState?.activeInstanceId : undefined);');

    expect(pendingIntentSource).toContain('const effectiveActiveInstanceId = activeSummary.latestInstanceId;');
    expect(pendingIntentSource).toContain('const hasActiveGuard = activeSummary.activeCount > 0 && effectiveActiveInstanceId !== instanceId;');
    expect(pendingIntentSource).not.toContain('const effectiveActiveInstanceId = observedActiveInstanceId ?? (activeTurnCount > 0 ? guardState?.activeInstanceId : undefined);');
  });
});