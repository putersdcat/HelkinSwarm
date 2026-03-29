import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('skillForge bundle store runtime wiring', () => {
  it('supports both connection-string and identity-based AzureWebJobsStorage settings', () => {
    const source = readFileSync('src/orchestrator/skillForgeBundleStore.ts', 'utf8');

    expect(source).toContain("process.env['AzureWebJobsStorage__accountName']");
    expect(source).toContain('getCredential()');
    expect(source).toContain('BlobServiceClient.fromConnectionString');
    expect(source).toContain('new BlobServiceClient(');
  });
});