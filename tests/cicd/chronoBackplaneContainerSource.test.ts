import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('chrono backplane infra source guard', () => {
  it('provisions the chronoBackplane Cosmos container expected by the living-mind seams', () => {
    const source = readFileSync('infra/main.bicep', 'utf8');

    expect(source).toContain("resource containerChronoBackplane 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {");
    expect(source).toContain("name: 'chronoBackplane'");
    expect(source).toContain("id: 'chronoBackplane'");
    expect(source).toContain("partitionKey: { paths: [ '/userId' ], kind: 'Hash' }");
  });
});