import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('send reply stage-clear source guards', () => {
  it('clears the orchestrator stage immediately after visible reply delivery so later turns are not blocked by post-reply residue', () => {
    const source = readFileSync('src/orchestrator/sendReplyActivity.ts', 'utf8');

    expect(source).toContain("import { clearOrchestratorStage, getOrchestratorStageForCorrelation, recordSubstage } from '../observability/orchestratorStageHealth.js';");
    expect(source).toContain("trackEvent({ name: 'ReplySent'");
    expect(source).toContain('await clearOrchestratorStage(input.correlationId, input.userId);');
    expect(source).toContain('Stage clear timed out/failed after visible reply delivery');
  });
});