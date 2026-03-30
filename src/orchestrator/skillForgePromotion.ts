import { loadCapabilities } from '../capabilities/capabilityLoader.js';
import { pushRepositoryFiles } from '../integrations/githubRepoContentClient.js';
import {
  loadSkillForgeBundle,
  validatePromotableSkillForgeBundle,
} from './skillForgeBundleStore.js';

export interface PromoteSkillForgeBundleResult {
  skillId: string;
  bundlePath: string;
  branch: string;
  commitMessage: string;
  fileResults: Array<{
    path: string;
    action: 'created' | 'updated';
    commitSha: string;
  }>;
  reloadSummary: {
    skillsLoaded: number;
    toolsRegistered: number;
    errors: Array<{ path: string; error: string }>;
  };
}

export async function promoteSkillForgeBundle(bundlePath: string): Promise<PromoteSkillForgeBundleResult> {
  const bundle = validatePromotableSkillForgeBundle(await loadSkillForgeBundle(bundlePath));
  const commitMessage = `feat(#367): promote SkillForge bundle ${bundle.skillId}`;
  const fileResults = await pushRepositoryFiles({
    branch: 'main',
    message: commitMessage,
    files: bundle.files.map((file) => ({ path: file.path, content: file.content })),
  });

  const reloadSummary = await loadCapabilities();

  return {
    skillId: bundle.skillId,
    bundlePath,
    branch: 'main',
    commitMessage,
    fileResults,
    reloadSummary,
  };
}