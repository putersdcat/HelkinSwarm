import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('discoveryToolInjection visibility instrumentation', () => {
  it('emits telemetry breadcrumbs when hidden discovery routing policies fire', () => {
    const sessionOrchestrator = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const followUpActivity = readFileSync('src/orchestrator/llmFollowUpActivity.ts', 'utf8');

    expect(sessionOrchestrator).toContain("authority: 'discovery-readonly-query-rewrite'");
    expect(sessionOrchestrator).toContain("authority: 'discovery-deterministic-initial-tool-call'");
    expect(sessionOrchestrator).toContain("authority: 'discovery-forced-initial-tool-choice'");
    expect(sessionOrchestrator).toContain("authority: 'discovery-deterministic-followup-tool-call'");
    expect(sessionOrchestrator).toContain("authority: 'discovery-forced-followup-tool-choice'");

    expect(followUpActivity).toContain("authority: 'discovery-deterministic-followup-tool-call'");
  });
});