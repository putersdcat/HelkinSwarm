import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('session orchestrator failover notice propagation', () => {
  it('rehydrates failover notices from raw failover steps so they survive tool follow-up rounds', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const llmSource = readFileSync('src/orchestrator/llmActivity.ts', 'utf8');
    const followUpSource = readFileSync('src/orchestrator/llmFollowUpActivity.ts', 'utf8');

    expect(source).toContain("import { buildSuccessfulFailoverNotices } from '../llm/foundryClient.js';");
    expect(source).toContain("function rememberOperationalEvidence(");
    expect(source).toContain('for (const notice of buildSuccessfulFailoverNotices(result.failoverSteps)) {');
    expect(source).toContain('rememberOperationalEvidence(operationalNotices, llmResult);');
    expect(source).toContain('rememberOperationalEvidence(operationalNotices, followUp);');
    expect(llmSource).toContain('failoverSteps: response.failoverSteps ?? [],');
    expect(followUpSource).toContain('export function mergeFollowUpResponseEvidence(');
    expect(followUpSource).toContain('const followUpResponses: ChatCompletionResponse[] = [response];');
    expect(followUpSource).toContain('followUpResponses.push(retryResponse);');
    expect(followUpSource).toContain('const evidence = mergeFollowUpResponseEvidence(followUpResponses);');
  });
});