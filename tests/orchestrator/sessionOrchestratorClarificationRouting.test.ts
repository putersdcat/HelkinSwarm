import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sessionOrchestrator clarification routing', () => {
  it('uses the effective resumed task text for discovery forcing and follow-up routing', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('const effectiveTaskMessage = userMessageForLlm;');
    expect(source).toContain('const initialToolSchemas = getDiscoveryFirstToolSchemas();');
    expect(source).toContain('const deterministicInitialToolCall = synthesizeExactToolCall(effectiveTaskMessage, initialToolSchemas);');
    expect(source).toContain('const deterministicExactToolResponse = buildDeterministicExactToolResponse(');
    expect(source).toContain('toolChoice: getForcedInitialToolChoice(effectiveTaskMessage, initialToolSchemas) ?? \'auto\'');
    expect(source).toContain('const deterministicFollowUpToolCall = synthesizeDeterministicFollowUpToolCall(');
    expect(source).toContain('effectiveTaskMessage,');
    expect(source).toContain('getForcedDiscoveryFollowUpToolChoice(effectiveTaskMessage, selectiveFollowUpSchemas)');
    expect(source).toContain('buildDiscoveryDeadEndResponse(effectiveTaskMessage)');
    expect(source).toContain('userContext: effectiveTaskMessage,');
    expect(source).toContain('originalQuery: effectiveTaskMessage,');
    expect(source).not.toContain('toolChoice: shouldForceDiscoveryToolSearch(input.userMessage)');
    expect(source).not.toContain('getForcedDiscoveryFollowUpToolChoice(input.userMessage, selectiveFollowUpSchemas)');
  });
});
