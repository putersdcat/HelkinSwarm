// Version module test — verifies the canonical version source works.
// Issue: #153

import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '../../src/config/version.js';

describe('version', () => {
  it('reads version from package.json', () => {
    expect(APP_VERSION).toBe('1.0.8');
  });

  it('is a valid semver string', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
