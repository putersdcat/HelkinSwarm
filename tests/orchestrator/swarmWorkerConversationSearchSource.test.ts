// Source-level verification: swarm worker auto-injects conversation_search tool.
// Issue: #633

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

describe('swarmWorkerActivity — conversation_search auto-injection', () => {
  it('declares CONVERSATION_SEARCH_TOOL constant', () => {
    expect(workerSrc).toContain("const CONVERSATION_SEARCH_TOOL = 'conversation_search'");
  });

  it('auto-injects conversation_search if not already in assigned tools', () => {
    expect(workerSrc).toContain('CONVERSATION_SEARCH_TOOL');
    expect(workerSrc).toContain('seenNames.has(CONVERSATION_SEARCH_TOOL)');
  });

  it('deduplicates already-assigned conversation_search', () => {
    expect(workerSrc).toContain('seenNames.has(name)');
  });

  it('dispatches conversation_search calls even when not in assignedTools', () => {
    // The dispatch condition must accept CONVERSATION_SEARCH_TOOL as a valid tool
    expect(workerSrc).toContain('tc.function.name === CONVERSATION_SEARCH_TOOL');
  });
});
