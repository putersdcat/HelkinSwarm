import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('deploy-router early-dev cost guard wiring', () => {
  it('enforces the router early-dev cost guard, cleans up paid observability leftovers, and asserts live invariants', () => {
    const source = readFileSync('.github/workflows/deploy-router.yml', 'utf8');

    expect(source).toContain("EARLY_DEV_COST_GUARD: 'true'");
    expect(source).toContain("EARLY_DEV_MONTHLY_BUDGET_USD: '10'");
    expect(source).toContain('Validate early-dev cost guard prerequisites');
    expect(source).toContain('earlyDevCostGuard=${{ env.EARLY_DEV_COST_GUARD }}');
    expect(source).toContain('earlyDevMonthlyBudgetUsd=${{ env.EARLY_DEV_MONTHLY_BUDGET_USD }}');
    expect(source).toContain('Remove paid observability leftovers in router dirty dev mode');
    expect(source).toContain('Assert router early-dev cost guard invariants');
    expect(source).toContain('helkinswarm-earlydev-budget-router');
  });
});