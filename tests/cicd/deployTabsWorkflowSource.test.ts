import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('deploy-tabs workflow', () => {
  it('auto-deploys on tab-host changes and publishes a trimmed user-map asset', () => {
    const source = readFileSync('.github/workflows/deploy-tabs.yml', 'utf8');

    expect(source).toContain('push:');
    expect(source).toContain("- 'tabs/**'");
    expect(source).toContain("- 'config/user-map.json'");
    expect(source).toContain('tabs/user-map.json');
    expect(source).toContain("with_entries(.value |= { alias, endpoint, enabled })");
    expect(source).toContain('TAB_ASSET_VERSION');
    expect(source).toContain('no-cache, no-store, must-revalidate');
    expect(source).not.toContain('Injected TAB_API_BASE');
    expect(source).toContain('Production tab build keeps TAB_API_BASE unset so runtime user-map routing is authoritative');
    expect(source).toContain('tabs/app.js no longer contains the TAB_API_BASE placeholder');
  });
});