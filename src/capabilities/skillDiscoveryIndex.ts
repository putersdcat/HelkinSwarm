import type { CapabilityManifest, CapabilityGroup as CapabilityGroupManifestEntry, ModelAffinity, ToolManifestEntry } from './manifestSchema.js';
import { assessSkillOperationalState, type SkillOperationalState } from './skillOperationalState.js';

export interface SkillDiscoverySkillEntry {
  domain: string;
  displayName: string;
  shortDescription: string;
  operationalState: SkillOperationalState;
  operationalSummary: string;
  discoveryHints: string[];
  orchestratorUseCases: string[];
  recommendedEntryTools: string[];
  modelAffinity?: ModelAffinity;
  toolNames: string[];
  toolCount: number;
}

export interface SkillDiscoveryToolEntry {
  name: string;
  domain: string;
  description: string;
  risk: ToolManifestEntry['risk'];
  dataSensitivity: ToolManifestEntry['dataSensitivity'];
  allowedModelLane: ToolManifestEntry['allowedModelLane'];
  requiresConfirmation: boolean;
  requiresExecutor: boolean;
  requiresSubAgent: boolean;
  privilegeClass: ToolManifestEntry['privilegeClass'];
  aliases: string[];
  discoveryTerms: string[];
  useWhen: string[];
  avoidWhen: string[];
  typicalInputs: string[];
  returnsSummaryShape?: string;
  capabilityGroup?: string;
}

export interface SkillDiscoveryCapabilityGroupEntry {
  id: string;
  domain: string;
  displayName: string;
  shortDescription: string;
  discoveryHints: string[];
  useWhen: string[];
  toolNames: string[];
  toolCount: number;
  upstreamNamespace?: string;
  upstreamToolSelectors: string[];
}

export interface SkillDiscoveryIndex {
  generatedAt: string;
  skills: SkillDiscoverySkillEntry[];
  capabilityGroups: SkillDiscoveryCapabilityGroupEntry[];
  tools: SkillDiscoveryToolEntry[];
}

export interface SkillDiscoverySearchHit {
  type: 'skill' | 'capability-group' | 'tool';
  id: string;
  domain: string;
  score: number;
  matchReasons: string[];
}

export interface SkillDiscoverySearchResult {
  generatedAt: string | null;
  query: string;
  skills: SkillDiscoverySearchHit[];
  capabilityGroups: SkillDiscoverySearchHit[];
  tools: SkillDiscoverySearchHit[];
}

let currentIndex: SkillDiscoveryIndex = {
  generatedAt: new Date(0).toISOString(),
  skills: [],
  capabilityGroups: [],
  tools: [],
};

export function clearSkillDiscoveryIndex(): void {
  currentIndex = {
    generatedAt: new Date(0).toISOString(),
    skills: [],
    capabilityGroups: [],
    tools: [],
  };
}

export function rebuildSkillDiscoveryIndex(manifests: CapabilityManifest[]): SkillDiscoveryIndex {
  const installedDomains = new Set(manifests.map((manifest) => manifest.domain));
  const skills: SkillDiscoverySkillEntry[] = manifests.map((manifest) => {
    const assessment = assessSkillOperationalState(manifest, installedDomains);
    return {
      domain: manifest.domain,
      displayName: manifest.displayName,
      shortDescription: manifest.shortDescription,
      operationalState: assessment.operationalState,
      operationalSummary: assessment.message,
      discoveryHints: manifest.discoveryHints ?? [],
      orchestratorUseCases: manifest.orchestratorUseCases ?? [],
      recommendedEntryTools: manifest.recommendedEntryTools ?? [],
      modelAffinity: manifest.modelAffinity,
      toolNames: manifest.tools.map((tool) => tool.name),
      toolCount: manifest.tools.length,
    };
  });

  const capabilityGroups: SkillDiscoveryCapabilityGroupEntry[] = manifests.flatMap((manifest) =>
    (manifest.capabilityGroups ?? []).map((group: CapabilityGroupManifestEntry) => ({
      id: `${manifest.domain}/${group.id}`,
      domain: manifest.domain,
      displayName: group.displayName,
      shortDescription: group.shortDescription,
      discoveryHints: group.discoveryHints ?? [],
      useWhen: group.useWhen ?? [],
      toolNames: manifest.tools.filter((tool) => tool.capabilityGroup === group.id).map((tool) => tool.name),
      toolCount: manifest.tools.filter((tool) => tool.capabilityGroup === group.id).length,
      upstreamNamespace: group.upstreamNamespace,
      upstreamToolSelectors: group.upstreamToolSelectors ?? [],
    })),
  );

  const tools: SkillDiscoveryToolEntry[] = manifests.flatMap((manifest) =>
    manifest.tools.map((tool) => ({
      name: tool.name,
      domain: manifest.domain,
      description: tool.description,
      risk: tool.risk,
      dataSensitivity: tool.dataSensitivity,
      allowedModelLane: tool.allowedModelLane,
      requiresConfirmation: tool.requiresConfirmation,
      requiresExecutor: tool.requiresExecutor,
      requiresSubAgent: tool.requiresSubAgent,
      privilegeClass: tool.privilegeClass,
      aliases: tool.aliases ?? [],
      discoveryTerms: tool.discoveryTerms ?? [],
      useWhen: tool.useWhen ?? [],
      avoidWhen: tool.avoidWhen ?? [],
      typicalInputs: tool.typicalInputs ?? [],
      returnsSummaryShape: tool.returnsSummaryShape,
      capabilityGroup: tool.capabilityGroup,
    })),
  );

  currentIndex = {
    generatedAt: new Date().toISOString(),
    skills,
    capabilityGroups,
    tools,
  };

  return currentIndex;
}

export function getSkillDiscoveryIndex(): SkillDiscoveryIndex {
  return currentIndex;
}

export function getDiscoverySkill(domain: string): SkillDiscoverySkillEntry | undefined {
  return currentIndex.skills.find((skill) => skill.domain === domain);
}

export function getDiscoveryCapabilityGroup(id: string): SkillDiscoveryCapabilityGroupEntry | undefined {
  return currentIndex.capabilityGroups.find((group) => group.id === id);
}

export function getDiscoveryTool(name: string): SkillDiscoveryToolEntry | undefined {
  return currentIndex.tools.find((tool) => tool.name === name);
}

export function searchSkillDiscoveryIndex(
  query: string,
  limits: { skillLimit?: number; toolLimit?: number } = {},
): SkillDiscoverySearchResult {
  const normalizedTokens = tokenize(query);
  const skillLimit = limits.skillLimit ?? 5;
  const toolLimit = limits.toolLimit ?? 8;

  const skills = currentIndex.skills
    .map((skill) => buildSkillHit(skill, normalizedTokens))
    .filter((hit): hit is SkillDiscoverySearchHit => hit !== null)
    .sort(sortHits)
    .slice(0, skillLimit);

  const capabilityGroups = currentIndex.capabilityGroups
    .map((group) => buildCapabilityGroupHit(group, normalizedTokens))
    .filter((hit): hit is SkillDiscoverySearchHit => hit !== null)
    .sort(sortHits)
    .slice(0, toolLimit);

  const tools = currentIndex.tools
    .map((tool) => buildToolHit(tool, normalizedTokens))
    .filter((hit): hit is SkillDiscoverySearchHit => hit !== null)
    .sort(sortHits)
    .slice(0, toolLimit);

  return {
    generatedAt: currentIndex.generatedAt === new Date(0).toISOString() ? null : currentIndex.generatedAt,
    query,
    skills,
    capabilityGroups,
    tools,
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function scoreFields(tokens: string[], weightedFields: Array<{ label: string; values: string[]; weight: number }>): { score: number; reasons: string[] } {
  let score = 0;
  const reasons = new Set<string>();

  for (const token of tokens) {
    for (const field of weightedFields) {
      if (field.values.some((value) => value.includes(token))) {
        score += field.weight;
        reasons.add(field.label);
      }
    }
  }

  return {
    score,
    reasons: Array.from(reasons),
  };
}

function buildSkillHit(skill: SkillDiscoverySkillEntry, tokens: string[]): SkillDiscoverySearchHit | null {
  if (tokens.length === 0) return null;
  const scored = scoreFields(tokens, [
    { label: 'domain', values: [skill.domain.toLowerCase()], weight: 6 },
    { label: 'display-name', values: [skill.displayName.toLowerCase()], weight: 5 },
    { label: 'description', values: [skill.shortDescription.toLowerCase()], weight: 4 },
    { label: 'discovery-hints', values: skill.discoveryHints.map((value) => value.toLowerCase()), weight: 4 },
    { label: 'use-cases', values: skill.orchestratorUseCases.map((value) => value.toLowerCase()), weight: 3 },
    { label: 'entry-tools', values: skill.recommendedEntryTools.map((value) => value.toLowerCase()), weight: 2 },
  ]);

  if (scored.score === 0) return null;
  return {
    type: 'skill',
    id: skill.domain,
    domain: skill.domain,
    score: scored.score,
    matchReasons: scored.reasons,
  };
}

function buildCapabilityGroupHit(group: SkillDiscoveryCapabilityGroupEntry, tokens: string[]): SkillDiscoverySearchHit | null {
  if (tokens.length === 0) return null;
  const scored = scoreFields(tokens, [
    { label: 'group-id', values: [group.id.toLowerCase()], weight: 6 },
    { label: 'group-name', values: [group.displayName.toLowerCase()], weight: 5 },
    { label: 'group-description', values: [group.shortDescription.toLowerCase()], weight: 4 },
    { label: 'group-discovery-hints', values: group.discoveryHints.map((value) => value.toLowerCase()), weight: 4 },
    { label: 'group-use-when', values: group.useWhen.map((value) => value.toLowerCase()), weight: 3 },
    { label: 'group-tools', values: group.toolNames.map((value) => value.toLowerCase()), weight: 2 },
    { label: 'upstream-namespace', values: group.upstreamNamespace ? [group.upstreamNamespace.toLowerCase()] : [], weight: 3 },
  ]);

  if (scored.score === 0) return null;
  return {
    type: 'capability-group',
    id: group.id,
    domain: group.domain,
    score: scored.score,
    matchReasons: scored.reasons,
  };
}

function buildToolHit(tool: SkillDiscoveryToolEntry, tokens: string[]): SkillDiscoverySearchHit | null {
  if (tokens.length === 0) return null;
  const scored = scoreFields(tokens, [
    { label: 'tool-name', values: [tool.name.toLowerCase()], weight: 6 },
    { label: 'domain', values: [tool.domain.toLowerCase()], weight: 3 },
    { label: 'description', values: [tool.description.toLowerCase()], weight: 4 },
    { label: 'aliases', values: tool.aliases.map((value) => value.toLowerCase()), weight: 5 },
    { label: 'capability-group', values: tool.capabilityGroup ? [tool.capabilityGroup.toLowerCase()] : [], weight: 3 },
    { label: 'discovery-terms', values: tool.discoveryTerms.map((value) => value.toLowerCase()), weight: 4 },
    { label: 'use-when', values: tool.useWhen.map((value) => value.toLowerCase()), weight: 3 },
    { label: 'typical-inputs', values: tool.typicalInputs.map((value) => value.toLowerCase()), weight: 2 },
  ]);

  if (scored.score === 0) return null;
  return {
    type: 'tool',
    id: tool.name,
    domain: tool.domain,
    score: scored.score,
    matchReasons: scored.reasons,
  };
}

function sortHits(left: SkillDiscoverySearchHit, right: SkillDiscoverySearchHit): number {
  return right.score - left.score || left.id.localeCompare(right.id);
}