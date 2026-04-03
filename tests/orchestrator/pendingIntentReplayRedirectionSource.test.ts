import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('pending intent replay living-session redirection source guards', () => {
  it('redirects replayed work into the active overseer when a routable living session exists', () => {
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');

    expect(replaySource).toContain('const activeSessionRoutable = hasActiveGuard && effectiveActiveInstanceId !== undefined;');
    expect(replaySource).toContain('activeSessionRoutable,');
    expect(replaySource).toContain("authority: 'living-session-active-redirection'");
    expect(replaySource).toContain("await client.raiseEvent(effectiveActiveInstanceId, 'NewMessage', event);");
    expect(replaySource).toContain("action: 'redirected'");
  });
});