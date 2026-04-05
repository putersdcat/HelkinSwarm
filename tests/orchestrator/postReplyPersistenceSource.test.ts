import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('post-reply persistence source guards', () => {
  it('bounds post-reply state persistence and passes the turn correlation into saveStateActivity', () => {
    const saveStateSource = readFileSync('src/orchestrator/saveStateActivity.ts', 'utf8');
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(saveStateSource).toContain("import { recordSubstage } from '../observability/orchestratorStageHealth.js';");
    expect(saveStateSource).toContain('const SAVE_STATE_TIMEOUT_MS = 5_000;');
    expect(saveStateSource).toContain("recordSubstage(input.correlationId, 'save-state', input.state.userId);");
    expect(saveStateSource).toContain('await withTimeout(saveState(input.state), SAVE_STATE_TIMEOUT_MS);');
    expect(saveStateSource).toContain('[saveStateActivity] Skipping state persistence after timeout/error');
    expect(saveStateSource).toContain("correlationId: input.correlationId ?? input.state.userId");

    expect(overseerSource).toContain("yield context.df.callActivity('saveStateActivity', {");
    expect(overseerSource).toContain('correlationId: sessionInput.correlationId,');
    expect(sessionSource).toContain("yield context.df.callActivity('saveStateActivity', {");
    expect(sessionSource).toContain('correlationId,');
  });
});