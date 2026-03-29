import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tab shell asset versioning', () => {
  it('cache-busts styles and scripts through a deploy-time asset version placeholder', () => {
    const source = readFileSync('tabs/index.html', 'utf8');

    expect(source).toContain('styles.css?v={{TAB_ASSET_VERSION}}');
    expect(source).toContain('vendor/microsoftTeams.min.js?v={{TAB_ASSET_VERSION}}');
    expect(source).toContain('app.js?v={{TAB_ASSET_VERSION}}');
  });
});