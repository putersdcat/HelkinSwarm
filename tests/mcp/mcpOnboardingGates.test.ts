import { describe, expect, it } from 'vitest';
import { assessMcpCandidateForOnboarding, draftSkillIdForCandidate } from '../../src/mcp/mcpOnboardingGates.js';
import type { McpRegistryCandidate } from '../../src/mcp/mcpRegistryCatalog.js';

function buildCandidate(overrides: Partial<McpRegistryCandidate> = {}): McpRegistryCandidate {
  return {
    name: 'io.github.example/demo',
    title: 'Demo MCP',
    description: 'Demo candidate',
    latestVersion: '1.0.0',
    status: 'active',
    statusMessage: null,
    repositoryUrl: null,
    websiteUrl: null,
    publishedAt: '2026-03-30T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    packageSummaries: [
      {
        registryType: 'npm',
        identifier: '@example/demo',
        version: '1.0.0',
        transportType: 'stdio',
      },
    ],
    remoteSummaries: [],
    transportTypes: ['stdio'],
    searchableText: 'demo mcp example',
    ...overrides,
  };
}

describe('mcpOnboardingGates', () => {
  it('marks active draftable candidates as discovered and AI-approval eligible', () => {
    const result = assessMcpCandidateForOnboarding(buildCandidate());
    expect(result.currentState).toBe('discovered');
    expect(result.activationGate.aiApprovalEligible).toBe(true);
    expect(result.activationGate.blockedReasons).toEqual([]);
    expect(result.activationGate.reviewReasons).toEqual([]);
  });

  it('marks deprecated candidates as review-required and disables direct AI approval', () => {
    const result = assessMcpCandidateForOnboarding(buildCandidate({ status: 'deprecated' }));
    expect(result.currentState).toBe('review-required');
    expect(result.activationGate.aiApprovalEligible).toBe(false);
    expect(result.activationGate.reviewReasons.join(' ')).toContain('deprecated');
  });

  it('blocks deleted or non-draftable candidates deterministically', () => {
    const deleted = assessMcpCandidateForOnboarding(buildCandidate({ status: 'deleted' }));
    expect(deleted.currentState).toBe('blocked');
    expect(deleted.activationGate.blockedReasons.join(' ')).toContain('deleted');

    const remoteOnly = assessMcpCandidateForOnboarding(buildCandidate({
      packageSummaries: [],
      remoteSummaries: [{ transportType: 'streamable-http', url: 'https://example.com/mcp' }],
      transportTypes: ['streamable-http'],
    }));
    expect(remoteOnly.currentState).toBe('blocked');
    expect(remoteOnly.activationGate.blockedReasons.join(' ')).toContain('npm/stdio');
  });

  it('uses the normalized skill id convention for installed/enabled correlation', () => {
    expect(draftSkillIdForCandidate('io.github.j0hanz/filesystem-mcp')).toBe('mcp-io-github-j0hanz-filesystem-mcp');
  });
});
