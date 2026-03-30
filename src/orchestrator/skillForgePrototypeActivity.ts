import * as df from 'durable-functions';
import { z } from 'zod';
import { persistSkillForgeBundle } from './skillForgeBundleStore.js';

const SKILLFORGE_ICON_URL = 'https://helkinswarmtabsst.z20.web.core.windows.net/icons/core.png';

const SkillForgeInputSchema = z.object({
  idea: z.string().min(1),
  userId: z.string().min(1),
  correlationId: z.string().min(1),
});

export interface SkillForgePrototypeInput {
  idea: string;
  userId: string;
  correlationId: string;
}

export interface SkillForgePrototypeResult {
  skillId: string;
  displayName: string;
  summary: string;
  branchName: string;
  persistedBundlePath: string | null;
  files: Array<{
    path: string;
    content: string;
    purpose: string;
  }>;
  reviewTitle: string;
  reviewBody: string;
}

function slugifyIdea(idea: string): string {
  return idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'new-skill';
}

function toDisplayName(skillId: string): string {
  return skillId
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildSkillForgePrototype(input: SkillForgePrototypeInput): SkillForgePrototypeResult {
  const parsed = SkillForgeInputSchema.parse(input);
  const baseSkillId = slugifyIdea(parsed.idea);
  const skillId = `forge-${baseSkillId}`;
  const displayName = toDisplayName(skillId);
  const skillDir = `skills/custom/${skillId}`;
  const manifestPath = `${skillDir}/manifest.json`;
  const handlersPath = `${skillDir}/handlers.ts`;
  const testPath = `tests/skills/${skillId}.test.ts`;
  const branchName = `skillforge/${skillId}`;

  const manifestContent = JSON.stringify({
    domain: skillId,
    shortName: skillId,
    version: '0.1.0',
    displayName,
    shortDescription: `SkillForge prototype for: ${parsed.idea}`,
    iconUrl: SKILLFORGE_ICON_URL,
    deploymentScenario: 'personal-user-centric',
    onboardingMethod: 'automatic-agentic',
    lifecycleRules: 'keep-credentials',
    discoveryHints: [parsed.idea, displayName, skillId],
    orchestratorUseCases: [`Prototype generated from SkillForge idea: ${parsed.idea}`],
    recommendedEntryTools: [`${skillId.replace(/-/g, '_')}_run`],
    tools: [
      {
        name: `${skillId.replace(/-/g, '_')}_run`,
        description: `Prototype entry tool for ${displayName}`,
        risk: 'medium',
        dataSensitivity: 'non-pii',
        allowedModelLane: 'any',
        requiresConfirmation: true,
        requiresExecutor: false,
        externalAutomationCapabilities: [],
        longTermMemorySchema: [],
        inputSchema: {
          type: 'object',
          properties: {
            request: {
              type: 'string',
              description: 'Natural-language request for the prototype skill.',
            },
          },
          required: ['request'],
        },
        privilegeClass: 'create',
        requiresSubAgent: true,
      },
    ],
  }, null, 2);

  const handlersContent = [
    "import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';",
    "import { registerHandler } from '../../src/capabilities/capabilityLoader.js';",
    '',
    `export const ${skillId.replace(/-/g, '_')}_run: ToolHandler = async (args) => {`,
    "  const request = String(args['request'] ?? '');",
    '  return {',
    `    status: 'prototype',`,
    `    skillId: '${skillId}',`,
    `    message: 'SkillForge prototype placeholder for ${displayName}.',`,
    '    request,',
    '  };',
    '};',
    '',
    `registerHandler('${skillId.replace(/-/g, '_')}_run', ${skillId.replace(/-/g, '_')}_run);`,
    '',
  ].join('\n');

  const testContent = [
    "import { describe, expect, it } from 'vitest';",
    '',
    `describe('${skillId} prototype scaffold', () => {`,
    "  it('documents the intended prototype entry tool', () => {",
    `    expect('${skillId.replace(/-/g, '_')}_run').toContain('${skillId.replace(/-/g, '_')}');`,
    '  });',
    '});',
    '',
  ].join('\n');

  const reviewTitle = `SkillForge prototype: ${displayName}`;
  const reviewBody = [
    `Prototype request: ${parsed.idea}`,
    '',
    'Bundle includes:',
    `- ${manifestPath}`,
    `- ${handlersPath}`,
    `- ${testPath}`,
    '',
    'Review checklist:',
    '- validate manifest schema + tool naming',
    '- replace placeholder handler logic with real implementation',
    '- expand tests before activation',
    '- keep the skill disabled until human review is complete',
  ].join('\n');

  const summary = [
    `⚙️ SkillForge prepared a PR-ready prototype bundle for **${displayName}**.`,
    '',
    `Requested idea: ${parsed.idea}`,
    '',
    'Artifacts:',
    `- \`${manifestPath}\` — manifest scaffold`,
    `- \`${handlersPath}\` — handler scaffold`,
    `- \`${testPath}\` — test scaffold`,
    '',
    `Suggested review title: ${reviewTitle}`,
    'Branch + review-body handoff metadata prepared in the prototype bundle.',
    'Persisted bundle path will be included when storage is available.',
    'Owner approval gate: run `/forge promote <persisted-bundle-path>` to promote the reviewed bundle into tracked repository files.',
    '',
    'Next step: review the scaffold, replace placeholder logic, and keep the skill disabled until human approval.',
  ].join('\n');

  return {
    skillId,
    displayName,
    summary,
    branchName,
    persistedBundlePath: null,
    reviewTitle,
    reviewBody,
    files: [
      { path: manifestPath, content: manifestContent, purpose: 'manifest scaffold' },
      { path: handlersPath, content: handlersContent, purpose: 'handler scaffold' },
      { path: testPath, content: testContent, purpose: 'test scaffold' },
    ],
  };
}

df.app.activity('skillForgePrototypeActivity', {
  handler: async (input: SkillForgePrototypeInput): Promise<SkillForgePrototypeResult> => {
    const result = buildSkillForgePrototype(input);
    const persistedBundlePath = await persistSkillForgeBundle({
      userId: input.userId,
      skillId: result.skillId,
      correlationId: input.correlationId,
      payload: {
        skillId: result.skillId,
        displayName: result.displayName,
        branchName: result.branchName,
        reviewTitle: result.reviewTitle,
        reviewBody: result.reviewBody,
        files: result.files,
      },
    });

    return {
      ...result,
      persistedBundlePath,
      summary: persistedBundlePath
        ? `${result.summary}\n\nPersisted bundle: \`${persistedBundlePath}\``
        : result.summary,
    };
  },
});
