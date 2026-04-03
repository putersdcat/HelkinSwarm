import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop self-awaken proof surface', () => {
  it('exposes an owner-only helper to register chrono-backed self-awaken events', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("route: 'devloop/self-awaken'");
    expect(source).toContain("authLevel: 'function'");
    expect(source).toContain('delaySeconds: z.number().int().min(1).max(600).default(70)');
    expect(source).toContain('const conversationReference = await getConversationReference(userId);');
    expect(source).toContain('const wake = await saveChronoScheduledWake({');
    expect(source).toContain("name: 'ChronoScheduledWakeRegistered'");
  });
});