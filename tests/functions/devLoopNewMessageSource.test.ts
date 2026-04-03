import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop new-message injection proof surface', () => {
  it('exposes an owner-only helper that raises NewMessage into the active living session', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("route: 'devloop/new-message'");
    expect(source).toContain('const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, userId);');
    expect(source).toContain("await client.raiseEvent(activeOverseerInstanceId, 'NewMessage', event);");
    expect(source).toContain('correlationPrefix: z.string().min(3).max(80).default(\'devloop-injected\')');
    expect(source).toContain('status: 500,');
    expect(source).toContain('jsonBody: {');
    expect(source).toContain('error: message,');
  });
});