import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Control Center costs UI source', () => {
  it('adds a Costs sub-tab that calls the stamp costs backend', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('{ key: "costs", label: "Costs" }');
    expect(source).toContain('apiCall("costs")');
    expect(source).toContain('Top Services');
  });

  it('includes date-range filters, daily/weekly/monthly granularity, and grouped spend sections', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('Last 7 Days');
    expect(source).toContain('Last 14 Days');
    expect(source).toContain('Month To Date');
    expect(source).toContain('Weekly');
    expect(source).toContain('Monthly');
    expect(source).toContain('Spend Groups');
    expect(source).toContain('Model Metrics');
    expect(source).toContain('costs-interactive-root');
  });
});