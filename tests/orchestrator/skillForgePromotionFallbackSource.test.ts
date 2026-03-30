import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('skillForge promotion permission fallback', () => {
  it('returns a manual fallback when GitHub contents writes are blocked by app permissions', () => {
    const source = readFileSync('src/orchestrator/skillForgePromotion.ts', 'utf8');

    expect(source).toContain("status: 'manual-fallback'");
    expect(source).toContain('instanceof GitHubContentsPermissionError');
    expect(source).toContain('owner-side GitHub tooling');
    expect(source).toContain('grant the HelkinSwarm GitHub App installation repository contents write access');
  });
});