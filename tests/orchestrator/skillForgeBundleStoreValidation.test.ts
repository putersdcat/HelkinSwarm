import { describe, expect, it } from 'vitest';
import { buildSkillForgePrototype } from '../../src/orchestrator/skillForgePrototypeActivity.js';
import { validatePromotableSkillForgeBundle } from '../../src/orchestrator/skillForgeBundleStore.js';

describe('validatePromotableSkillForgeBundle', () => {
  it('accepts the current SkillForge prototype bundle as promotion-safe', () => {
    const prototype = buildSkillForgePrototype({
      idea: 'create a receipts parser skill',
      userId: 'owner-user',
      correlationId: 'corr-1',
    });

    expect(() => validatePromotableSkillForgeBundle({
      skillId: prototype.skillId,
      displayName: prototype.displayName,
      branchName: prototype.branchName,
      reviewTitle: prototype.reviewTitle,
      reviewBody: prototype.reviewBody,
      files: prototype.files,
    })).not.toThrow();
  });
});