import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('global tab SPA runtime stamp routing', () => {
  it('resolves the current Teams user to a per-stamp tab API via user-map.json', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('var USER_MAP_URL = "user-map.json";');
    expect(source).toContain('resolveTabApiBase()');
    expect(source).toContain('users[_userOid]');
    expect(source).toContain('normalizeEndpointToTabApiBase(entry.endpoint)');
    expect(source).toContain('No stamp mapping exists for this Teams user.');
    expect(source).toContain('This user\'s HelkinSwarm stamp is disabled.');
    expect(source).toContain('isLocalDevFallbackAllowed()');
    expect(source).toContain('hostname === "localhost"');
    expect(source).toContain('hostname === "127.0.0.1"');
    expect(source).toContain('Tab unavailable');
  });
});