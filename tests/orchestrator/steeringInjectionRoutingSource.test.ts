import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('steering injection wiring source guards', () => {
  it('registers and wires steering injection into session start and prompt assembly', () => {
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const promptSource = readFileSync('src/orchestrator/buildPromptActivity.ts', 'utf8');

    expect(indexSource).toContain("import '../orchestrator/steeringInjectionActivity.js';");
    expect(sessionSource).toContain("'steeringInjectionActivity'");
    expect(sessionSource).toContain('steeringContext: steeringInjection.injectionBlock,');
    expect(promptSource).toContain('steeringContext?: string;');
    expect(promptSource).toContain("input.steeringContext ?? '',");
  });
});