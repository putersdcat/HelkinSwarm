import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('deploy-tabs workflow', () => {
  it('auto-deploys on tab-host changes, preserves trimmed runtime routing data, and enforces the tab-host cost guard', () => {
    const source = readFileSync('.github/workflows/deploy-tabs.yml', 'utf8');

    expect(source).toContain('push:');
    expect(source).toContain("- 'tabs/**'");
    expect(source).toContain("- 'config/user-map.json'");
    expect(source).toContain("EARLY_DEV_COST_GUARD: 'true'");
    expect(source).toContain("EARLY_DEV_MONTHLY_BUDGET_USD: '5'");
    expect(source).toContain('Validate early-dev cost guard prerequisites');
    expect(source).toContain('Assert tab-host early-dev cost guard invariants');
    expect(source).toContain('helkinswarm-earlydev-budget-tabs');
    expect(source).toContain('tabs/user-map.json');
    expect(source).toContain("with_entries(.value |= { alias, endpoint, enabled })");
    expect(source).toContain('TAB_ASSET_VERSION');
    expect(source).toContain('no-cache, no-store, must-revalidate');
    expect(source).not.toContain('Injected TAB_API_BASE');
    expect(source).toContain('Production tab build keeps TAB_API_BASE unset so runtime user-map routing is authoritative');
    expect(source).toContain('tabs/app.js no longer contains the TAB_API_BASE placeholder');
  });
});