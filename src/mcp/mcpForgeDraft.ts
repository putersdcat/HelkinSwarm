import { z } from 'zod';
import { CapabilityManifestSchema, type CapabilityManifest } from '../capabilities/manifestSchema.js';
import { FoundryClient, textContent } from '../llm/foundryClient.js';
import { getModelForTask, getModelRouting } from '../llm/modelRouter.js';
import {
  ensureFreshMcpRegistryCatalog,
  getMcpRegistryCandidate,
  type McpRegistryCandidate,
} from './mcpRegistryCatalog.js';
import { persistSkillForgeBundle, type PersistedMcpForgeBundle, type SkillForgeBundleFile } from '../orchestrator/skillForgeBundleStore.js';

const McpForgeDraftInputSchema = z.object({
  candidateName: z.string().min(1),
  userId: z.string().min(1),
  correlationId: z.string().min(1),
  useCase: z.string().min(1).optional(),
});

export interface McpForgeDraftInput {
  candidateName: string;
  userId: string;
  correlationId: string;
  useCase?: string;
}

export interface McpForgeDraftResult {
  status: 'drafted' | 'rejected' | 'not-found';
  candidateName: string;
  draftSkillId: string | null;
  displayName: string | null;
  summary: string;
  persistedBundlePath: string | null;
  reviewTitle: string | null;
  reviewBody: string | null;
  evaluationSummary: string | null;
  uncertainties: string[];
  recommendedNextSteps: string[];
  files: SkillForgeBundleFile[];
}

const McpForgeEvaluationSchema = z.object({
  decision: z.enum(['draft', 'reject']),
  displayName: z.string().min(1),
  shortDescription: z.string().min(1),
  deploymentScenario: z.enum(['personal-user-centric', 'enterprise-commercial']),
  onboardingMethod: z.enum(['automatic-agentic', 'post-install-link', 'both']),
  lifecycleRules: z.enum(['keep-credentials', 'close-external-account', 'ask-user']),
  discoveryHints: z.array(z.string().min(1)).min(2).max(8),
  orchestratorUseCases: z.array(z.string().min(1)).min(1).max(6),
  dependencies: z.array(z.string().min(1)).max(8),
  requiredPermissions: z.array(z.string().min(1)).max(12),
  externalAccountsNeeded: z.array(z.string().min(1)).max(8),
  risk: z.enum(['low', 'medium', 'high']),
  dataSensitivity: z.enum(['non-pii', 'pii', 'mixed']),
  privilegeClass: z.enum(['read-only', 'read-write', 'create', 'delete']),
  evaluationSummary: z.string().min(1),
  fitSummary: z.string().min(1),
  installAssumptions: z.array(z.string().min(1)).max(10),
  transportAssumptions: z.array(z.string().min(1)).max(10),
  uncertainties: z.array(z.string().min(1)).min(1).max(12),
  recommendedNextSteps: z.array(z.string().min(1)).min(1).max(10),
  rejectionReason: z.string().nullable(),
});

type McpForgeEvaluation = z.infer<typeof McpForgeEvaluationSchema>;

type EvaluateCandidateFn = (candidate: McpRegistryCandidate, input: McpForgeDraftInput, draftSkillId: string) => Promise<McpForgeEvaluation>;

type PersistBundleFn = (bundle: PersistedMcpForgeBundle, input: McpForgeDraftInput, draftSkillId: string) => Promise<string | null>;

type BuildMcpForgeDraftDependencies = {
  evaluateCandidate?: EvaluateCandidateFn;
  persistBundle?: PersistBundleFn;
};

const MCP_FORGE_PROMPT = `You are McpForge, a conservative MCP onboarding evaluator for HelkinSwarm.
You are drafting a review bundle for a discovered third-party MCP server candidate.
Return ONLY compact JSON matching this shape:
{
  "decision": "draft" | "reject",
  "displayName": string,
  "shortDescription": string,
  "deploymentScenario": "personal-user-centric" | "enterprise-commercial",
  "onboardingMethod": "automatic-agentic" | "post-install-link" | "both",
  "lifecycleRules": "keep-credentials" | "close-external-account" | "ask-user",
  "discoveryHints": string[],
  "orchestratorUseCases": string[],
  "dependencies": string[],
  "requiredPermissions": string[],
  "externalAccountsNeeded": string[],
  "risk": "low" | "medium" | "high",
  "dataSensitivity": "non-pii" | "pii" | "mixed",
  "privilegeClass": "read-only" | "read-write" | "create" | "delete",
  "evaluationSummary": string,
  "fitSummary": string,
  "installAssumptions": string[],
  "transportAssumptions": string[],
  "uncertainties": string[],
  "recommendedNextSteps": string[],
  "rejectionReason": string | null
}
Rules:
- Be conservative. If metadata is too ambiguous for a usable review draft, set decision to reject.
- Never pretend to know the remote tool inventory unless it is explicitly given.
- Treat preview, auth, transport, permissions, and package-runtime assumptions as uncertainties when not explicit.
- Prefer enterprise-commercial when the server clearly targets admin, tenant, or business workflows.
- Use post-install-link or both when auth/account setup is likely needed.
- Privilege should reflect likely external impact, not wishful optimism.
- Keep discovery hints and use cases practical and short.
- Include at least one uncertainty and one next step even when decision=draft.`;

export async function buildMcpForgeDraftBundle(
  rawInput: McpForgeDraftInput,
  dependencies: BuildMcpForgeDraftDependencies = {},
): Promise<McpForgeDraftResult> {
  const input = McpForgeDraftInputSchema.parse(rawInput);
  await ensureFreshMcpRegistryCatalog();

  const candidate = getMcpRegistryCandidate(input.candidateName);
  if (!candidate) {
    return {
      status: 'not-found',
      candidateName: input.candidateName,
      draftSkillId: null,
      displayName: null,
      summary: `No cached MCP Registry candidate was found for '${input.candidateName}'. Search the registry first, then retry with an exact candidate name.`,
      persistedBundlePath: null,
      reviewTitle: null,
      reviewBody: null,
      evaluationSummary: null,
      uncertainties: [],
      recommendedNextSteps: ['Search the MCP Registry for the candidate first and retry with the exact server name.'],
      files: [],
    };
  }

  const draftSkillId = draftSkillIdForCandidate(candidate.name);
  const evaluation = await (dependencies.evaluateCandidate ?? evaluateCandidateWithLlm)(candidate, input, draftSkillId);

  const stdioPackage = selectDraftableStdioPackage(candidate);
  if (!stdioPackage) {
    const rejection = buildRejectedBundle(candidate, draftSkillId, evaluation, [
      ...evaluation.uncertainties,
      'Current HelkinSwarm MCP runtime supports only manifest-declared stdio servers for activation.',
      'This candidate does not expose a draftable npm/stdio package shape that McpForge can normalize safely yet.',
    ], [
      'Capture the candidate’s actual runtime launch instructions before trying to onboard it.',
      'Add broader transport/runtime support only after a reviewed connector extension exists.',
      ...evaluation.recommendedNextSteps,
    ]);

    const persistedBundlePath = await (dependencies.persistBundle ?? persistMcpForgeBundle)(rejection.bundle, input, draftSkillId);
    return {
      status: 'rejected',
      candidateName: candidate.name,
      draftSkillId,
      displayName: evaluation.displayName,
      summary: rejection.summary,
      persistedBundlePath,
      reviewTitle: rejection.bundle.reviewTitle,
      reviewBody: rejection.bundle.reviewBody,
      evaluationSummary: rejection.bundle.evaluationSummary,
      uncertainties: rejection.bundle.uncertainties,
      recommendedNextSteps: rejection.bundle.recommendedNextSteps,
      files: rejection.bundle.files,
    };
  }

  if (evaluation.decision === 'reject' || candidate.status === 'deleted') {
    const rejection = buildRejectedBundle(candidate, draftSkillId, evaluation);
    const persistedBundlePath = await (dependencies.persistBundle ?? persistMcpForgeBundle)(rejection.bundle, input, draftSkillId);
    return {
      status: 'rejected',
      candidateName: candidate.name,
      draftSkillId,
      displayName: evaluation.displayName,
      summary: rejection.summary,
      persistedBundlePath,
      reviewTitle: rejection.bundle.reviewTitle,
      reviewBody: rejection.bundle.reviewBody,
      evaluationSummary: rejection.bundle.evaluationSummary,
      uncertainties: rejection.bundle.uncertainties,
      recommendedNextSteps: rejection.bundle.recommendedNextSteps,
      files: rejection.bundle.files,
    };
  }

  const manifestDraft = buildManifestDraft(candidate, stdioPackage, draftSkillId, evaluation);
  const manifestDraftPath = `drafts/mcpforge/${draftSkillId}/manifest.draft.json`;
  const reviewNotesPath = `drafts/mcpforge/${draftSkillId}/review.md`;
  const branchName = `mcpforge/${draftSkillId}`;
  const reviewTitle = `McpForge draft: ${evaluation.displayName}`;
  const reviewBody = buildReviewBody(candidate, evaluation, manifestDraftPath, reviewNotesPath);
  const files: SkillForgeBundleFile[] = [
    {
      path: manifestDraftPath,
      content: JSON.stringify(manifestDraft, null, 2),
      purpose: 'draft manifest for AI smoke-test approval and later source graduation',
    },
    {
      path: reviewNotesPath,
      content: buildReviewMarkdown(candidate, evaluation, manifestDraft),
      purpose: 'review notes, assumptions, and uncertainty report',
    },
  ];

  const bundle: PersistedMcpForgeBundle = {
    bundleKind: 'mcpforge',
    candidateName: candidate.name,
    draftSkillId,
    displayName: evaluation.displayName,
    branchName,
    status: 'drafted',
    reviewTitle,
    reviewBody,
    evaluationSummary: evaluation.evaluationSummary,
    uncertainties: dedupe(evaluation.uncertainties),
    recommendedNextSteps: dedupe(evaluation.recommendedNextSteps),
    candidateSnapshot: buildCandidateSnapshot(candidate),
    files,
  };

  const persistedBundlePath = await (dependencies.persistBundle ?? persistMcpForgeBundle)(bundle, input, draftSkillId);

  return {
    status: 'drafted',
    candidateName: candidate.name,
    draftSkillId,
    displayName: evaluation.displayName,
    summary: [
      `McpForge drafted a review bundle for **${evaluation.displayName}** from registry candidate \
    \`${candidate.name}\`.`,
      `Draft manifest: \`${manifestDraftPath}\``,
      `Review notes: \`${reviewNotesPath}\``,
      persistedBundlePath ? `Persisted bundle: \`${persistedBundlePath}\`` : 'Persisted bundle path unavailable on this stamp.',
      'This bundle is not active yet; it can be AI-approved into the running stamp after smoke test passes.',
    ].join('\n'),
    persistedBundlePath,
    reviewTitle,
    reviewBody,
    evaluationSummary: evaluation.evaluationSummary,
    uncertainties: bundle.uncertainties,
    recommendedNextSteps: bundle.recommendedNextSteps,
    files,
  };
}

export async function inspectMcpForgeBundle(bundlePath: string): Promise<PersistedMcpForgeBundle> {
  const { loadMcpForgeBundle } = await import('../orchestrator/skillForgeBundleStore.js');
  return loadMcpForgeBundle(bundlePath);
}

async function evaluateCandidateWithLlm(candidate: McpRegistryCandidate, input: McpForgeDraftInput, draftSkillId: string): Promise<McpForgeEvaluation> {
  const fastModel = getModelForTask('fast');
  const routing = getModelRouting();
  const fastRouting = { ...routing, deploymentName: fastModel, isReasoning: false };
  const client = new FoundryClient(fastRouting);

  const candidatePayload = JSON.stringify({
    candidate: buildCandidateSnapshot(candidate),
    draftSkillId,
    useCase: input.useCase ?? null,
    runtimeDraftability: {
      hasDraftableStdioNpmPackage: Boolean(selectDraftableStdioPackage(candidate)),
      packageSummaries: candidate.packageSummaries,
      remoteSummaries: candidate.remoteSummaries,
    },
  }, null, 2);

  const response = await client.chatCompletion({
    messages: [
      { role: 'system', content: MCP_FORGE_PROMPT },
      { role: 'user', content: candidatePayload },
    ],
    temperature: 0.1,
    maxTokens: 900,
    correlationId: input.correlationId,
  });

  const content = textContent(response.choices[0]?.message?.content);
  const parsedJson = extractJsonObject(content);
  return McpForgeEvaluationSchema.parse(parsedJson);
}

function buildManifestDraft(
  candidate: McpRegistryCandidate,
  stdioPackage: z.infer<typeof DraftableStdioPackageSchema>,
  draftSkillId: string,
  evaluation: McpForgeEvaluation,
): CapabilityManifest {
  const placeholderToolName = `${draftSkillId.replace(/-/g, '_')}_pending_inventory_capture`;
  const manifest = CapabilityManifestSchema.parse({
    domain: draftSkillId,
    version: '0.1.0-draft',
    shortName: draftSkillId,
    displayName: evaluation.displayName,
    shortDescription: evaluation.shortDescription,
    iconUrl: 'https://helkinswarmtabsst.z20.web.core.windows.net/icons/core.png',
    deploymentScenario: evaluation.deploymentScenario,
    onboardingMethod: evaluation.onboardingMethod,
    lifecycleRules: evaluation.lifecycleRules,
    dependencies: evaluation.dependencies,
    requiredPermissions: evaluation.requiredPermissions,
    externalAccountsNeeded: evaluation.externalAccountsNeeded,
    discoveryHints: dedupe(evaluation.discoveryHints),
    orchestratorUseCases: dedupe(evaluation.orchestratorUseCases),
    recommendedEntryTools: [placeholderToolName],
    mcpServer: {
      transport: 'stdio',
      command: stdioPackage.command,
      args: stdioPackage.args,
      timeoutMs: 20_000,
    },
    tools: [
      {
        name: placeholderToolName,
        description: `Draft-only placeholder tool for ${evaluation.displayName}. Replace after real MCP tool inventory capture and AI smoke-test approval.`,
        risk: evaluation.risk,
        dataSensitivity: evaluation.dataSensitivity,
        allowedModelLane: 'any',
        requiresConfirmation: true,
        requiresExecutor: false,
        requiresSubAgent: false,
        privilegeClass: evaluation.privilegeClass,
        externalAutomationCapabilities: [],
        longTermMemorySchema: [],
        aliases: ['draft placeholder'],
        discoveryTerms: ['pending inventory capture', candidate.name],
        useWhen: ['only while the candidate is still in draft or smoke-test approval stage'],
        avoidWhen: ['you need actual runtime MCP tool execution'],
        typicalInputs: ['capture the actual remote MCP tool inventory'],
        returnsSummaryShape: 'draft placeholder result pending AI smoke-test approval',
        inputSchema: {
          type: 'object',
          properties: {
            note: { type: 'string', description: 'Review note only; not a real runtime tool.' },
          },
          required: [],
        },
      },
    ],
  });

  return manifest;
}

const DraftableStdioPackageSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string().min(1)).min(1),
});

function selectDraftableStdioPackage(candidate: McpRegistryCandidate): z.infer<typeof DraftableStdioPackageSchema> | null {
  const npmStdioPackage = candidate.packageSummaries.find((pkg) => pkg.registryType === 'npm' && pkg.transportType === 'stdio');
  if (!npmStdioPackage) {
    return null;
  }

  const identifierWithVersion = npmStdioPackage.version
    ? `${npmStdioPackage.identifier}@${npmStdioPackage.version}`
    : npmStdioPackage.identifier;

  return DraftableStdioPackageSchema.parse({
    command: 'npx',
    args: ['-y', identifierWithVersion],
  });
}

function buildRejectedBundle(
  candidate: McpRegistryCandidate,
  draftSkillId: string,
  evaluation: McpForgeEvaluation,
  forcedUncertainties?: string[],
  forcedNextSteps?: string[],
): { bundle: PersistedMcpForgeBundle; summary: string } {
  const uncertainties = dedupe(forcedUncertainties ?? evaluation.uncertainties);
  const recommendedNextSteps = dedupe(forcedNextSteps ?? evaluation.recommendedNextSteps);
  const reviewPath = `drafts/mcpforge/${draftSkillId}/review.md`;
  const reviewTitle = `McpForge rejection: ${evaluation.displayName}`;
  const reviewBody = [
    `Candidate: ${candidate.name}`,
    `Decision: rejected`,
    '',
    evaluation.rejectionReason ?? 'Candidate rejected due to ambiguous or unsafe normalization conditions.',
  ].join('\n');

  const bundle: PersistedMcpForgeBundle = {
    bundleKind: 'mcpforge',
    candidateName: candidate.name,
    draftSkillId,
    displayName: evaluation.displayName,
    branchName: `mcpforge/${draftSkillId}`,
    status: 'rejected',
    reviewTitle,
    reviewBody,
    evaluationSummary: evaluation.evaluationSummary,
    uncertainties,
    recommendedNextSteps,
    candidateSnapshot: buildCandidateSnapshot(candidate),
    files: [
      {
        path: reviewPath,
        content: buildRejectedReviewMarkdown(candidate, evaluation, uncertainties, recommendedNextSteps),
        purpose: 'rejection rationale and next-step audit trail',
      },
    ],
  };

  return {
    bundle,
    summary: [
      `McpForge rejected registry candidate \`${candidate.name}\` for direct draft normalization.`,
      evaluation.rejectionReason ?? 'Metadata was too ambiguous or unsafe to normalize conservatively.',
      `Review notes: \`${reviewPath}\``,
    ].join('\n'),
  };
}

function buildReviewBody(
  candidate: McpRegistryCandidate,
  evaluation: McpForgeEvaluation,
  manifestPath: string,
  reviewNotesPath: string,
): string {
  return [
    `Candidate: ${candidate.name}`,
    `Status: ${candidate.status}`,
    '',
    'Bundle contents:',
    `- ${manifestPath}`,
    `- ${reviewNotesPath}`,
    '',
    'Review checklist:',
    '- verify candidate trust, publisher, and repository provenance',
    '- capture the actual MCP tool inventory before any source-graduation PR',
    '- confirm runtime launch assumptions and auth prerequisites',
    '- keep this draft outside active skills until the AI smoke test approves it locally',
    '',
    `Fit summary: ${evaluation.fitSummary}`,
  ].join('\n');
}

function buildReviewMarkdown(
  candidate: McpRegistryCandidate,
  evaluation: McpForgeEvaluation,
  manifestDraft: CapabilityManifest,
): string {
  return [
    `# McpForge draft review — ${evaluation.displayName}`,
    '',
    `Candidate: \`${candidate.name}\``,
    `Candidate status: \`${candidate.status}\``,
    `Draft skill id: \`${manifestDraft.domain}\``,
    '',
    '## Evaluation summary',
    '',
    evaluation.evaluationSummary,
    '',
    '## Transport assumptions',
    '',
    ...evaluation.transportAssumptions.map((item) => `- ${item}`),
    '',
    '## Installation assumptions',
    '',
    ...evaluation.installAssumptions.map((item) => `- ${item}`),
    '',
    '## Uncertainties',
    '',
    ...evaluation.uncertainties.map((item) => `- ${item}`),
    '',
    '## Recommended next steps',
    '',
    ...evaluation.recommendedNextSteps.map((item) => `- ${item}`),
    '',
    '## Candidate snapshot',
    '',
    `- title: ${candidate.title ?? '(none)'}`,
    `- latestVersion: ${candidate.latestVersion}`,
    `- repositoryUrl: ${candidate.repositoryUrl ?? '(none)'}`,
    `- websiteUrl: ${candidate.websiteUrl ?? '(none)'}`,
    `- transportTypes: ${candidate.transportTypes.join(', ')}`,
  ].join('\n');
}

function buildRejectedReviewMarkdown(
  candidate: McpRegistryCandidate,
  evaluation: McpForgeEvaluation,
  uncertainties: string[],
  recommendedNextSteps: string[],
): string {
  return [
    `# McpForge rejection — ${candidate.name}`,
    '',
    `Candidate status: \`${candidate.status}\``,
    '',
    '## Evaluation summary',
    '',
    evaluation.evaluationSummary,
    '',
    '## Rejection reason',
    '',
    evaluation.rejectionReason ?? 'Candidate metadata could not be normalized safely into a draft bundle.',
    '',
    '## Uncertainties',
    '',
    ...uncertainties.map((item) => `- ${item}`),
    '',
    '## Recommended next steps',
    '',
    ...recommendedNextSteps.map((item) => `- ${item}`),
  ].join('\n');
}

function buildCandidateSnapshot(candidate: McpRegistryCandidate): PersistedMcpForgeBundle['candidateSnapshot'] {
  return {
    name: candidate.name,
    title: candidate.title,
    description: candidate.description,
    latestVersion: candidate.latestVersion,
    status: candidate.status,
    statusMessage: candidate.statusMessage,
    repositoryUrl: candidate.repositoryUrl,
    websiteUrl: candidate.websiteUrl,
    transportTypes: candidate.transportTypes,
  };
}

async function persistMcpForgeBundle(
  bundle: PersistedMcpForgeBundle,
  input: McpForgeDraftInput,
  draftSkillId: string,
): Promise<string | null> {
  return persistSkillForgeBundle({
    userId: input.userId,
    skillId: draftSkillId,
    correlationId: input.correlationId,
    payload: bundle,
  });
}

function draftSkillIdForCandidate(candidateName: string): string {
  return `mcp-${candidateName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)}`;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => item.trim()).filter((item) => item.length > 0)) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('McpForge evaluation did not return JSON.');
  }
  return JSON.parse(match[0]) as unknown;
}
