import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('autonomic sub-session contract source guards', () => {
  it('keeps the conscious thread delegating narrow instrumental work instead of replacing it', () => {
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const subAgentSource = readFileSync('src/orchestrator/subAgentActivity.ts', 'utf8');
    const dispatchSource = readFileSync('src/orchestrator/toolDispatchActivity.ts', 'utf8');

    expect(sessionSource).toContain('instrumental/autonomic work');
    expect(sessionSource).toContain("callActivity('subAgentActivity'");
    expect(sessionSource).toContain('toolDispatchActivity');

    expect(subAgentSource).toContain('buildInstrumentalSubSessionSystemPrompt');
    expect(subAgentSource).toContain('executionKind: INSTRUMENTAL_SUB_SESSION_EXECUTION_KIND');
    expect(subAgentSource).toContain('returnsControlTo: CONSCIOUS_THREAD_EXECUTION_KIND');
    expect(subAgentSource).toContain('const tools = tool');
    expect(subAgentSource).toContain('tools: tools.length > 0 ? tools : undefined');

    expect(dispatchSource).toContain('executionKind: INSTRUMENTAL_DIRECT_DISPATCH_EXECUTION_KIND');
    expect(dispatchSource).toContain('returnsControlTo: CONSCIOUS_THREAD_EXECUTION_KIND');
    expect(dispatchSource).not.toContain('FoundryClient');
  });
});