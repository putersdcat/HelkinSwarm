import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('current conversation replay guard source guards', () => {
  it('uses the current turn conversation id for replay suppression instead of relying only on persisted state', () => {
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const promptSource = readFileSync('src/orchestrator/buildPromptActivity.ts', 'utf8');
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');

    expect(sessionSource).toContain('const turnConversationId = input.conversationReference?.conversation?.id ?? input.state.conversationId;');
    expect(sessionSource).toContain('conversationId: turnConversationId,');
    expect(promptSource).toContain('conversationId?: string;');
    expect(promptSource).toContain('const conversationId = input.conversationId ?? input.state.conversationId;');
    expect(promptSource).toContain("hasOutboundArtifactClaim(conversationId, 'reply', input.correlationId)");
    expect(overseerSource).toContain('const currentConversationId = event.conversationReference?.conversation?.id;');
    expect(overseerSource).toContain('state.conversationId = currentConversationId;');
  });
});