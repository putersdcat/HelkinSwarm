import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Azure Monitor dirty dev mode runtime guard', () => {
  it('only initializes the Azure Monitor exporter when dirty dev mode is off and a connection string exists', () => {
    const source = readFileSync('src/functions/index.ts', 'utf8');
    const envConfig = readFileSync('src/config/envConfig.ts', 'utf8');

    expect(source).toContain("const dirtyDevMode = process.env['DIRTY_DEV_MODE']?.toLowerCase() === 'true';");
    expect(source).toContain("const appInsightsConnectionString = process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];");
    expect(source).toContain('if (!dirtyDevMode && appInsightsConnectionString) {');
    expect(source).toContain('useAzureMonitor();');
    expect(envConfig).toContain('dirtyDevMode: z.boolean().default(false),');
    expect(envConfig).toContain("dirtyDevMode: process.env['DIRTY_DEV_MODE']?.toLowerCase() === 'true',");
  });
});