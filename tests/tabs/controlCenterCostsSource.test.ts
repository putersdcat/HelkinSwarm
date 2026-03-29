import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Control Center costs UI wiring', () => {
  it('adds a Costs sub-tab that calls the stamp costs backend', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('{ key: "costs", label: "Costs" }');
    expect(source).toContain('apiCall("costs")');
    expect(source).toContain('Daily Trend (Last 14 Days)');
    expect(source).toContain('Top Services');
  });
});