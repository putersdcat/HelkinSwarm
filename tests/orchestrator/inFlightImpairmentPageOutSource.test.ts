import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('in-flight impairment page-out source guards', () => {
  it('marks retryable LLM failures as page-out candidates and persists a paused task from the orchestrator', () => {
    const foundrySource = readFileSync('src/llm/foundryClient.ts', 'utf8');
    const llmActivitySource = readFileSync('src/orchestrator/llmActivity.ts', 'utf8');
    const followUpSource = readFileSync('src/orchestrator/llmFollowUpActivity.ts', 'utf8');
    const sessionOrchestratorSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');

    expect(foundrySource).toContain('export function shouldPageOutForLlmFailure(err: unknown): boolean {');
    expect(foundrySource).toContain('if (err instanceof FoundryFallbackExhaustedError) {');
    expect(foundrySource).toContain('if (err instanceof FoundryAllModelsDownError) {');
    expect(llmActivitySource).toContain('shouldPageOutForLlmFailure(err)');
    expect(llmActivitySource).toContain('shouldPageOut?: boolean;');
    expect(followUpSource).toContain('shouldPageOut: shouldPageOutForLlmFailure(err),');
    expect(sessionOrchestratorSource).toContain("yield context.df.callActivity('saveChronoPausedTaskActivity', {");
    expect(sessionOrchestratorSource).toContain("interruptedSource: 'mid-turn-llm-impairment'");
    expect(indexSource).toContain("import '../orchestrator/saveChronoPausedTaskActivity.js';");
  });
});