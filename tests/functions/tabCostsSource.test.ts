import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tab costs wiring', () => {
  it('registers the costs endpoint and imports it at startup', () => {
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');
    const routeSource = readFileSync('src/functions/tabCosts.ts', 'utf8');

    expect(indexSource).toContain("import './tabCosts.js';");
    expect(routeSource).toContain("route: 'tab/costs'");
    expect(routeSource).toContain('getAzureResourceGroupCostSummary');
  });
});