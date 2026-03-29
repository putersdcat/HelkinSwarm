import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('embedded Teams tab nav handling', () => {
  it('hides the inner SPA top nav once the Teams context is available', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('function hideEmbeddedNav()');
    expect(source).toContain("nav.style.display = 'none'");
    expect(source).toContain('hideEmbeddedNav();');
  });
});