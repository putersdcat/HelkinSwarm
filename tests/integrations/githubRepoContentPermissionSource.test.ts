import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('githubRepoContentClient permission error typing', () => {
  it('raises a dedicated contents-permission error for GitHub App integration 403 responses', () => {
    const source = readFileSync('src/integrations/githubRepoContentClient.ts', 'utf8');

    expect(source).toContain('class GitHubContentsPermissionError');
    expect(source).toContain("response.status === 403 && errorBody.includes('Resource not accessible by integration')");
    expect(source).toContain('throw new GitHubContentsPermissionError');
  });
});