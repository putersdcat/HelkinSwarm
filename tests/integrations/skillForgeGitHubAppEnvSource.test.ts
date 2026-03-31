import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('SkillForge GitHub App env name support', () => {
  it('prefers dedicated SkillForge GitHub App env names with fallback to legacy names', () => {
    const repoClient = readFileSync('src/integrations/githubRepoContentClient.ts', 'utf8');
    const githubSkillAuth = readFileSync('skills/github/githubAppAuth.ts', 'utf8');

    expect(repoClient).toContain("readGitHubAppSetting('SKILLFORGE_GITHUB_APP_ID', 'GITHUB_APP_ID')");
    expect(repoClient).toContain("readGitHubAppSetting('SKILLFORGE_GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_INSTALLATION_ID')");
    expect(repoClient).toContain("readGitHubAppSetting('SKILLFORGE_GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY')");

    expect(githubSkillAuth).toContain("readGitHubAppSetting('SKILLFORGE_GITHUB_APP_ID', 'GITHUB_APP_ID')");
    expect(githubSkillAuth).toContain("readGitHubAppSetting('SKILLFORGE_GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_INSTALLATION_ID')");
    expect(githubSkillAuth).toContain("readGitHubAppSetting('SKILLFORGE_GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY')");
  });
});