import { describe, expect, it } from 'vitest';
import { buildSkillForgePrototype } from '../../src/orchestrator/skillForgePrototypeActivity.js';
import { CapabilityManifestSchema } from '../../src/capabilities/manifestSchema.js';

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
    expect(result.branchName).toBe('skillforge/forge-create-a-receipts-parser-skill');
    expect(result.persistedBundlePath).toBeNull();
    expect(result.summary).toContain('Branch + review-body handoff metadata prepared in the prototype bundle.');
    expect(result.summary).toContain('Persisted bundle path will be included when storage is available.');
    expect(result.summary).toContain('/forge promote <persisted-bundle-path>');

    const manifestFile = result.files.find((file) => file.path.endsWith('/manifest.json'));
    expect(manifestFile).toBeDefined();
    const manifest = CapabilityManifestSchema.parse(JSON.parse(manifestFile!.content) as unknown);
    expect(manifest.shortName).toBe(result.skillId);
    expect(manifest.shortDescription).toContain('receipts parser');
    expect(manifest.onboardingMethod).toBe('automatic-agentic');
    expect(manifest.lifecycleRules).toBe('keep-credentials');
    expect(manifest.tools[0]?.requiresConfirmation).toBe(true);

    const handlersFile = result.files.find((file) => file.path.endsWith('/handlers.ts'));
    expect(handlersFile?.content).toContain("../../../src/capabilities/capabilityLoader.js");
  });
});
