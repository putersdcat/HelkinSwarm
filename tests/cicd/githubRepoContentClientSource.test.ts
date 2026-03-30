import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('githubRepoContentClient promotion write strategy', () => {
  it('tries create-first and only falls back to SHA lookup on 422', () => {
    const source = readFileSync('src/integrations/githubRepoContentClient.ts', 'utf8');

    expect(source).toContain("let response = await putRepositoryFile(file.path, branch, input.message, file.content);");
    expect(source).toContain('if (response.status === 422) {');
    expect(source).toContain('const existingSha = await fetchExistingSha(file.path, branch);');
    expect(source).toContain("response = await putRepositoryFile(file.path, branch, input.message, file.content, existingSha);");
  });
});