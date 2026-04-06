import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tabs early-dev cost guard bicep wiring', () => {
  it('adds an RG budget for the global tab host during the furious development phase', () => {
    const source = readFileSync('infra/main-tabs.bicep', 'utf8');

    expect(source).toContain('param earlyDevCostGuard bool = true');
    expect(source).toContain('param earlyDevMonthlyBudgetUsd int = 5');
    expect(source).toContain("resource tabsBudget 'Microsoft.Consumption/budgets@2024-08-01' = if (earlyDevCostGuard && alertEmail != '') {");
    expect(source).toContain("output tabsBudgetName string = earlyDevCostGuard && alertEmail != '' ? tabsBudget.name : ''");
  });
});