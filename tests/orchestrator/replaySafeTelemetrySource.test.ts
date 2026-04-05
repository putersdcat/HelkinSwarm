import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('replay-safe orchestrator telemetry source guards', () => {
  it('routes orchestrator lifecycle telemetry through a Durable activity instead of direct trackEvent calls', () => {
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const telemetryActivitySource = readFileSync('src/orchestrator/emitOrchestratorTelemetryActivity.ts', 'utf8');
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');

    expect(overseerSource).toContain("callActivity('emitOrchestratorTelemetryActivity'");
    expect(overseerSource).not.toContain("import { trackEvent } from '../observability/telemetry.js';");

    expect(sessionSource).toContain("function* emitOrchestratorTelemetry(");
    expect(sessionSource).toContain("callActivity('emitOrchestratorTelemetryActivity', input)");

    expect(telemetryActivitySource).toContain('trackEvent(input);');
    expect(indexSource).toContain("import '../orchestrator/emitOrchestratorTelemetryActivity.js';");
  });
});