import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('chrono backplane routing source guards', () => {
  it('registers the chrono seam and wires turn-write plus steering-read integration', () => {
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const steeringSource = readFileSync('src/orchestrator/steeringInjectionActivity.ts', 'utf8');

    expect(indexSource).toContain("import '../orchestrator/chronoBackplane.js';");
    expect(overseerSource).toContain("'saveChronoContinuityActivity'");
    expect(steeringSource).toContain("import { loadChronoContinuity } from './chronoBackplane.js';");
    expect(steeringSource).toContain('chronoContinuity = await loadChronoContinuity(input.state.userId);');
    expect(steeringSource).toContain("name: 'ChronoBackplaneRead'");
  });
});