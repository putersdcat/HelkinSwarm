import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('deploy-stamp OpenRouter cutover source wiring', () => {
  it('defaults stamped deployments to the OpenRouter provider while preserving reversible workflow control', () => {
    const workflow = readFileSync('.github/workflows/deploy-stamp.yml', 'utf8');
    const bicep = readFileSync('infra/main.bicep', 'utf8');
    const parameters = readFileSync('infra/main.parameters.json', 'utf8');
    const byokDoc = readFileSync('docs/0c-BYOK-External-LLM-Support.md', 'utf8');

    expect(workflow).toContain('LLM_PROVIDER:');
    expect(workflow).toContain('default: openrouter');
    expect(workflow).toContain("llmProvider=${{ github.event.inputs.LLM_PROVIDER || 'openrouter' }}");
    expect(workflow).toContain('| **LLM Provider** |');

    expect(bicep).toContain("param llmProvider string = 'openrouter'");
    expect(bicep).toContain("param openrouterFallbackPrimary string = 'minimax/minimax-m2.7'");
    expect(bicep).toContain("param openrouterFallbackSecondary string = 'minimax/minimax-m2.7'");

    expect(parameters).toContain('"value": "openrouter"');

    expect(byokDoc).toContain('Historical / supplementary design guidance');
    expect(byokDoc).toContain('0zb-OpenRouter-Model-Provider-Integration.md');
    expect(byokDoc).toContain('This file is retained as design context');
  });
});