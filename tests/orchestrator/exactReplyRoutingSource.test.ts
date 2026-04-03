import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('exact reply routing source guards', () => {
  it('short-circuits exact-reply prompts before tool routing and disables discovery forcing for them', () => {
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const discoverySource = readFileSync('src/orchestrator/discoveryToolInjection.ts', 'utf8');

    expect(discoverySource).toContain('export function parseExactReplyInstruction(userMessage: string): string | null');
    expect(discoverySource).toContain('if (parseExactReplyInstruction(userMessage)) {');
    expect(sessionSource).toContain('const exactReplyInstruction = parseExactReplyInstruction(userMessageForLlm);');
    expect(sessionSource).toContain("model: 'exact-reply-short-circuit'");
    expect(sessionSource).toContain('message: exactReplyInstruction,');
  });
});