import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('model profile runtime wiring source guards', () => {
  it('wires model-aware tool presentation into the live session path (#610)', () => {
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const promptSource = readFileSync('src/orchestrator/buildPromptActivity.ts', 'utf8');
    const llmSource = readFileSync('src/orchestrator/llmActivity.ts', 'utf8');
    const registrySource = readFileSync('src/tools/toolRegistry.ts', 'utf8');

    expect(sessionSource).toContain("toolRegistry.toFunctionSchemasForModel(initialToolSurfaceModelId)");
    expect(sessionSource).toContain("name: 'ModelProfileApplied'");
    expect(sessionSource).toContain('toolSummaryDefinitions: initialToolSummaryDefinitions');
    expect(sessionSource).toContain('applyModelProfileToFunctionSchemas(');

    expect(promptSource).toContain('toolSummaryDefinitions?: Array<{ name: string; description: string }>');
    expect(promptSource).toContain('const tools = input.toolSummaryDefinitions ?? getDiscoveryFirstToolDefinitions();');

    expect(llmSource).toContain("toolRegistry.toFunctionSchemasForModel(deploymentName).tools");

    expect(registrySource).toContain('function areModelProfilesEnabled(): boolean {');
    expect(registrySource).toContain("const raw = process.env['MODEL_PROFILES_ENABLED'];");
    expect(registrySource).toContain('export function applyModelProfileToFunctionSchemas(');
    expect(registrySource).toContain('toFunctionSchemasForModel(modelId: string | undefined): ProfiledFunctionSchemaResult');
  });
});
