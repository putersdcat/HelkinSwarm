import { loadCapabilities } from '../capabilities/capabilityLoader.js';
import {
  GitHubContentsPermissionError,
  pushRepositoryFiles,
} from '../integrations/githubRepoContentClient.js';
import {
  loadSkillForgeBundle,
  validatePromotableSkillForgeBundle,
} from './skillForgeBundleStore.js';

export interface PromoteSkillForgeBundleResult {
  status: 'promoted' | 'manual-fallback';
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
  fallbackReason?: string;
  nextSteps?: string[];
}

export async function promoteSkillForgeBundle(bundlePath: string): Promise<PromoteSkillForgeBundleResult> {
  const bundle = validatePromotableSkillForgeBundle(await loadSkillForgeBundle(bundlePath));
  const commitMessage = `feat(#367): promote SkillForge bundle ${bundle.skillId}`;
  try {
    const fileResults = await pushRepositoryFiles({
      branch: 'main',
      message: commitMessage,
      files: bundle.files.map((file) => ({ path: file.path, content: file.content })),
    });

    const reloadSummary = await loadCapabilities();

    return {
      status: 'promoted',
      skillId: bundle.skillId,
      bundlePath,
      branch: 'main',
      commitMessage,
      fileResults,
      reloadSummary,
    };
  } catch (err) {
    if (err instanceof GitHubContentsPermissionError) {
      return {
        status: 'manual-fallback',
        skillId: bundle.skillId,
        bundlePath,
        branch: 'main',
        commitMessage,
        fileResults: bundle.files.map((file) => ({
          path: file.path,
          action: 'created',
          commitSha: '',
        })),
        reloadSummary: {
          skillsLoaded: 0,
          toolsRegistered: 0,
          errors: [],
        },
        fallbackReason: `GitHub App on this stamp does not have repository contents write access for \`${err.path}\`.`,
        nextSteps: [
          'Promote the reviewed bundle via owner-side GitHub tooling from VS Code or the repository UI.',
          'Or grant the HelkinSwarm GitHub App installation repository contents write access, then retry the same `/forge promote <bundle>` command.',
        ],
      };
    }

    throw err;
  }
}