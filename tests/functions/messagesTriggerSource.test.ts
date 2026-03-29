import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('messages trigger early-response guard', () => {
  it('uses the widened 14s early-response timeout', () => {
    const source = readFileSync('src/functions/messages.ts', 'utf8');

    expect(source).toContain('const EARLY_RESPONSE_MS = 14_000;');
    expect(source).toContain('Use Promise.race with a 14s timeout');
  });
});