import { describe, expect, it } from 'vitest';
import { buildSkillForgePrototype } from '../../src/orchestrator/skillForgePrototypeActivity.js';

describe('skillForgePrototypeActivity', () => {
  it('builds a PR-ready scaffold bundle with manifest, handler, and test files', () => {
    const result = buildSkillForgePrototype({
      idea: 'create a receipts parser skill',
      userId: 'owner-user',
      correlationId: 'corr-1',
    });

    expect(result.skillId).toBe('forge-create-a-receipts-parser-skill');
    expect(result.files.map((file) => file.path)).toEqual([
      'skills/custom/forge-create-a-receipts-parser-skill/manifest.json',
      'skills/custom/forge-create-a-receipts-parser-skill/handlers.ts',
      'tests/skills/forge-create-a-receipts-parser-skill.test.ts',
    ]);
    expect(result.summary).toContain('manifest scaffold');
    expect(result.summary).toContain('handler scaffold');
    expect(result.summary).toContain('test scaffold');
    expect(result.reviewTitle).toContain('SkillForge prototype');
  });
});
