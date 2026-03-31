import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('SkillForge image workflow source wiring', () => {
  it('rebuilds on dev tooling changes and measures startup smoke', () => {
    const workflow = readFileSync('.github/workflows/skillforge-image.yml', 'utf8');
    const bicep = readFileSync('infra/main.bicep', 'utf8');

    expect(workflow).toContain('push:');
    expect(workflow).toContain("- 'infra/Dockerfile.skillforge'");
    expect(workflow).toContain("- 'infra/skillforge-bootstrap.mjs'");
    expect(workflow).toContain("- 'src/skillforge/skillforge-prompt.md'");
    expect(workflow).toContain("- 'package.json'");
    expect(workflow).toContain("- 'pnpm-lock.yaml'");
    expect(workflow).toContain('github.event.inputs.USER_ALIAS || vars.USER_ALIAS');
    expect(workflow).toContain('Measure startup smoke');
    expect(workflow).toContain('SkillForge container ready');
    expect(workflow).toContain('\\[skillforge-audit\\]');
    expect(workflow).toContain('did not emit bootstrap audit records');
    expect(workflow).toContain('exceeded 10s');

    expect(bicep).toContain("{ name: 'SKILLFORGE_TIMEOUT_MINUTES', value: '15' }");
    expect(bicep).toContain("{ name: 'SKILLFORGE_CPU_KILL_THRESHOLD', value: '80' }");
    expect(bicep).toContain("{ name: 'SKILLFORGE_MEMORY_LIMIT_MB', value: '2048' }");
  });
});