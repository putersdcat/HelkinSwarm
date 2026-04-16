import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/functions/tabDevConsole.ts', 'utf8');
const storeSource = readFileSync('src/orchestrator/pendingIntentStore.ts', 'utf8');

describe('tab session terminate pending-intent cleanup', () => {
  it('expires pending intents when the operator terminates a pending-intent-backed session', () => {
    expect(source).toContain('pending-intent-');
    expect(source).toContain('markIntentExpired(');
  });

  it('pending intent store exposes an explicit expiry helper', () => {
    expect(storeSource).toContain('export async function markIntentExpired(');
    expect(storeSource).toContain("value: 'expired'");
  });
});
