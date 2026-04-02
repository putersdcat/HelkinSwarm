import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('bot queue fallback correlation source guard', () => {
  it('passes the original correlationId into pending-intent creation on raiseToOverseer failure', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain('const failureReason = err instanceof Error ? err.message : String(err);');
    expect(source).toContain('correlationId,');
    expect(source).toContain('failureReason,');
  });
});