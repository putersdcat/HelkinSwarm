import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('router early-dev cost guard bicep wiring', () => {
  it('keeps the router observability stack off by default during the furious development phase and attaches an RG budget', () => {
    const source = readFileSync('infra/main-router.bicep', 'utf8');

    expect(source).toContain('param earlyDevCostGuard bool = true');
    expect(source).toContain('param earlyDevMonthlyBudgetUsd int = 10');
    expect(source).toContain("var routerLogsDestination   = earlyDevCostGuard ? 'azure-monitor' : 'log-analytics'");
    expect(source).toContain("resource routerLaw 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (!earlyDevCostGuard) {");
    expect(source).toContain("resource routerAppi 'Microsoft.Insights/components@2020-02-02' = if (!earlyDevCostGuard) {");
    expect(source).toContain("resource routerBudget 'Microsoft.Consumption/budgets@2024-08-01' = if (earlyDevCostGuard && alertEmail != '') {");
    expect(source).toContain("{ name: 'DIRTY_DEV_MODE', value: string(earlyDevCostGuard) }");
    expect(source).toContain("{ name: 'EARLY_DEV_COST_GUARD', value: string(earlyDevCostGuard) }");
    expect(source).toContain("{ name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Core', value: 'Warning' }");
  });
});