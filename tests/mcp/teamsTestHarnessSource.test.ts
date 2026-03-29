import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Teams test harness full probe evidence', () => {
  it('captures runtime health before and after sending and returns a message window', () => {
    const source = readFileSync('src/mcp/teamsTestHarness.ts', 'utf8');

    expect(source).toContain('async function fetchRuntimeHealth()');
    expect(source).toContain('const runtimeBefore = await fetchRuntimeHealth();');
    expect(source).toContain('const runtimeAfter = await fetchRuntimeHealth();');
    expect(source).toContain('const messageWindow = getHarnessMessageWindow(recentMessages, {');
    expect(source).toContain('sentMessageId: sent.id');
    expect(source).toContain('runtimeBefore,');
    expect(source).toContain('runtimeAfter,');
    expect(source).toContain('messageWindow,');
  });
});