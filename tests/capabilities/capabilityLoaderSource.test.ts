import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('capabilityLoader nested handler resolution', () => {
  it('uses the relative skill folder when resolving compiled handlers', () => {
    const source = readFileSync('src/capabilities/capabilityLoader.ts', 'utf8');

    expect(source).toContain('const relativeSkillDir = relative(root, skillDir).split(sep).join');
    expect(source).toContain("handlerModule: `skills/${relativeSkillDir}`");
    expect(source).toContain("const distSkillDir = join(process.cwd(), 'dist', 'skills', relativeSkillDir);");
  });
});