import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('lifecycle notices dedup source guards', () => {
  it('preserves both startup and shutdown timestamps and suppresses repeated deploy chatter across a longer window', () => {
    const source = readFileSync('src/bot/lifecycleNotices.ts', 'utf8');

    expect(source).toContain('const DEDUP_WINDOW_MS = 10 * 60_000;');
    expect(source).toContain('let existingDoc: LifecycleNoticeDoc | undefined;');
    expect(source).toContain('existingDoc = resource;');
    expect(source).toContain('...existingDoc,');
    expect(source).toContain('[field]: now,');
  });
});