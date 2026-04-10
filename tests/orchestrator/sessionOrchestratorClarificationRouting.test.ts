import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sessionOrchestrator clarification routing', () => {
  it('uses the effective resumed task text for discovery forcing and follow-up routing', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('let effectiveTaskMessage = buildContextAwareRoutingMessage(userMessageForLlm, {');
    expect(source).toContain('const isExplicitReadOnlyDiscoveryRequest = isReadOnlyDiscoveryRequest(effectiveTaskMessage);');
    expect(source).toContain('const readOnlyDiscoveryQuery = buildReadOnlyDiscoveryQuery(effectiveTaskMessage);');
    expect(source).toContain('effectiveTaskMessage = readOnlyDiscoveryQuery;');
    expect(source).toContain('const allToolSchemas = initialToolSurface.tools;');
    expect(source).toContain('const initialToolSchemas = deterministicInitialToolCall');
    expect(source).toContain('deriveContextAwareInitialToolSchemas(effectiveTaskMessage, allToolSchemas);');
    expect(source).toContain('synthesizeRuntimeAssetInlineEmailToolCall(');
    expect(source).toContain('?? synthesizeExactToolCall(effectiveTaskMessage, allToolSchemas)');
    expect(source).toContain('?? synthesizeDeterministicReadOnlyInitialToolCall(effectiveTaskMessage, allToolSchemas);');
    expect(source).toContain('const deterministicExactToolResponse = buildDeterministicExactToolResponse(');
    expect(source).toContain('const forcedInitialToolChoice = getForcedInitialToolChoice(effectiveTaskMessage, initialToolSchemas) ?? \'auto\';');
    expect(source).toContain('toolChoice: forcedInitialToolChoice,');
    expect(source).toContain('if (isExplicitReadOnlyDiscoveryRequest) {');
    expect(source).toContain('const followUpToolSchemas = followUpToolSurface.tools;');
    expect(source).toContain('const deterministicFollowUpToolCall = synthesizeExactToolCall(');
    expect(source).toContain(') ?? synthesizeDeterministicFollowUpToolCall(');
    expect(source).toContain('effectiveTaskMessage,');
    expect(source).toContain('followUpToolSchemas,');
    expect(source).toContain('const forcedFollowUpToolChoice = getForcedDiscoveryFollowUpToolChoice(');
    expect(source).toContain('toolChoice: forcedFollowUpToolChoice,');
    expect(source).toContain('buildDiscoveryDeadEndResponse(effectiveTaskMessage)');
    expect(source).toContain('userContext: effectiveTaskMessage,');
    expect(source).toContain('originalQuery: effectiveTaskMessage,');
    expect(source).not.toContain('toolChoice: shouldForceDiscoveryToolSearch(input.userMessage)');
    expect(source).not.toContain('getForcedDiscoveryFollowUpToolChoice(input.userMessage, selectiveFollowUpSchemas)');
  });
});
