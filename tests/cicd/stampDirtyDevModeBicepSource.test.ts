import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('stamp dirty dev mode bicep wiring', () => {
  it('can disable paid observability resources and set Container Apps logs destination to none', () => {
    const source = readFileSync('infra/main.bicep', 'utf8');

    expect(source).toContain('param dirtyDevMode bool = false');
    expect(source).toContain("var appLogsDestination     = dirtyDevMode ? 'azure-monitor' : 'log-analytics'");
    expect(source).toContain("resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (!dirtyDevMode)");
    expect(source).toContain("resource appInsights 'Microsoft.Insights/components@2020-02-02' = if (!dirtyDevMode)");
    expect(source).toContain("destination: appLogsDestination");
    expect(source).toContain("{ name: 'DIRTY_DEV_MODE', value: string(dirtyDevMode) }");
  });
});