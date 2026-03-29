import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tab AAD token concurrency guard', () => {
  it('memoizes the in-flight Teams SSO token request so parallel tab API calls do not race to null', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('var _aadTokenPromise = null;');
    expect(source).toContain('if (_aadTokenPromise) return _aadTokenPromise;');
    expect(source).toContain('_aadTokenPromise = microsoftTeams.authentication.getAuthToken()');
    expect(source).toContain('_aadTokenPromise = null;');
  });
});