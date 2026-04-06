import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('deploy-stamp dirty dev mode wiring', () => {
  it('forces the early-dev cost guard through the workflow and asserts the live Azure state after deploy', () => {
    const source = readFileSync('.github/workflows/deploy-stamp.yml', 'utf8');

    expect(source).toContain("EARLY_DEV_COST_GUARD: 'true'");
    expect(source).toContain("EARLY_DEV_MONTHLY_BUDGET_USD: '30'");
    expect(source).toContain('DIRTY_DEV_MODE:');
    expect(source).toContain('Validate early-dev cost guard prerequisites');
    expect(source).toContain('EARLY_DEV_COST_GUARD is active — always running Bicep to enforce cost-control invariants.');
    expect(source).toContain("dirtyDevMode=${{ github.event.inputs.DIRTY_DEV_MODE || 'false' }}");
    expect(source).toContain('earlyDevCostGuard=${{ env.EARLY_DEV_COST_GUARD }}');
    expect(source).toContain('earlyDevMonthlyBudgetUsd=${{ env.EARLY_DEV_MONTHLY_BUDGET_USD }}');
    expect(source).toContain('Assert early-dev cost guard invariants');
    expect(source).toContain("Container Apps environment logs destination is '$CAE_DEST' instead of 'none'");
    expect(source).toContain('Remove paid observability leftovers in dirty dev mode');
    expect(source).toContain('az functionapp config appsettings delete');
    expect(source).toContain('helkinswarm-law-${{ env.USER_ALIAS }}');
    expect(source).toContain('helkinswarm-earlydev-budget-${ALIAS}');
  });
});