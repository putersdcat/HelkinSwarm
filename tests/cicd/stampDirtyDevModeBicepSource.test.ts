import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('stamp dirty dev mode bicep wiring', () => {
  it('enforces paid observability off during the early dev cost guard and disables Container Apps log shipping (destination=none) — drops the implicit Azure Monitor ingest charge that breached the cost cap (#716)', () => {
    const source = readFileSync('infra/main.bicep', 'utf8');

    expect(source).toContain('param dirtyDevMode bool = false');
    expect(source).toContain('param earlyDevCostGuard bool = true');
    expect(source).toContain('param earlyDevMonthlyBudgetUsd int = 30');
    expect(source).toContain("var effectiveDirtyDevMode   = earlyDevCostGuard || dirtyDevMode");
    expect(source).toContain("var appLogsDestination      = effectiveDirtyDevMode ? '' : 'log-analytics'");
    expect(source).toContain('appLogsConfiguration: effectiveDirtyDevMode');
    expect(source).toContain('? null');
    expect(source).toContain("resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (!effectiveDirtyDevMode)");
    expect(source).toContain("resource appInsights 'Microsoft.Insights/components@2020-02-02' = if (!effectiveDirtyDevMode)");
    expect(source).toContain("resource earlyDevBudget 'Microsoft.Consumption/budgets@2024-08-01' = if (earlyDevCostGuard && alertEmail != '') {");
    expect(source).toContain("destination: appLogsDestination");
    expect(source).toContain("{ name: 'DIRTY_DEV_MODE', value: string(effectiveDirtyDevMode) }");
    expect(source).toContain("{ name: 'EARLY_DEV_COST_GUARD', value: string(earlyDevCostGuard) }");
    expect(source).toContain("{ name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Core', value: 'Warning' }");
  });
});