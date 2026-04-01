import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tab skills management wiring', () => {
  it('exposes install-readiness, uninstall-impact, and reload routes', () => {
    const source = readFileSync('src/functions/tabSkills.ts', 'utf8');

    expect(source).toContain("route: 'tab/skills/{skillId}/install-readiness'");
    expect(source).toContain("route: 'tab/skills/{skillId}/uninstall-impact'");
    expect(source).toContain("route: 'tab/skills/reload'");
    expect(source).toContain("route: 'tab/skills/mcp-registry/search'");
    expect(source).toContain("route: 'tab/skills/mcp-registry/draft'");
    expect(source).toContain("route: 'tab/skills/mcp-registry/approve'");
    expect(source).toContain('inspectSkillInstall');
    expect(source).toContain('inspectSkillUninstall');
    expect(source).toContain('searchMcpRegistryCatalog');
    expect(source).toContain('buildMcpForgeDraftBundle');
    expect(source).toContain('approveMcpForgeBundleLocally');
  });
});