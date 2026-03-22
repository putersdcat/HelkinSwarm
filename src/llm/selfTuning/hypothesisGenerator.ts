// Hypothesis Generator — creates candidate mask variants for benchmarking.
// Spec ref: 0m-Agentic-Tooling-Evaluation.md §4 — Hypothesis Generation
// Issue #96

import type { ModelProfile } from '../modelProfileSchema.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CandidateMask {
  /** Unique candidate ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** The candidate profile to test */
  profile: ModelProfile;
  /** Why this candidate was generated */
  rationale: string;
}

export interface DiscoveryReport {
  /** Model deployment name */
  model: string;
  /** Maximum tools the model handles well */
  observedMaxTools: number;
  /** Whether the model handles progressive reveal */
  supportsProgressiveReveal: boolean;
  /** Preferred schema style */
  preferredStyle: 'flat_json' | 'progressive' | 'mcp' | 'cli_mimic';
  /** Known failure patterns */
  failurePatterns: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate 3-5 candidate mask variants from a discovery report + base profile.
 * Spec says: "DevLoop creates 3-5 candidate masks (runtime report, public priors,
 * DevLoop hunches, MCP variant)."
 */
export function generateCandidates(
  base: ModelProfile,
  _discovery: DiscoveryReport | null,
): CandidateMask[] {
  const candidates: CandidateMask[] = [];
  const now = new Date().toISOString();

  // Candidate 1: Baseline (current profile as-is)
  candidates.push({
    id: randomUUID(),
    name: 'baseline',
    profile: { ...base },
    rationale: 'Control — current active profile unchanged.',
  });

  // Candidate 2: Compact mode — strip descriptions for context savings
  candidates.push({
    id: randomUUID(),
    name: 'compact',
    profile: {
      ...base,
      presentation: base.presentation,
      schemaInjection: {
        includeJsonSchema: true,
        includeExamples: false,
        compact: true,
      },
      meta: { updatedAt: now, updatedBy: 'self-tuning' },
    },
    rationale: 'Test if compact descriptions save tokens without hurting accuracy.',
  });

  // Candidate 3: Progressive reveal — drip-feed tools
  candidates.push({
    id: randomUUID(),
    name: 'progressive',
    profile: {
      ...base,
      presentation: 'progressive' as const,
      progressiveReveal: {
        initialToolCount: 5,
        expansionStep: 5,
      },
      meta: { updatedAt: now, updatedBy: 'self-tuning' },
    },
    rationale: 'Test if progressive reveal improves tool selection accuracy for this model.',
  });

  // Candidate 4: Tool limit — cap tools to prevent overload
  candidates.push({
    id: randomUUID(),
    name: 'capped_12',
    profile: {
      ...base,
      maxToolsPerTurn: 12,
      meta: { updatedAt: now, updatedBy: 'self-tuning' },
    },
    rationale: 'Test if limiting to 12 most-relevant tools improves accuracy.',
  });

  // Candidate 5: No examples — test if examples help or waste tokens
  candidates.push({
    id: randomUUID(),
    name: 'no_examples',
    profile: {
      ...base,
      examples: [],
      schemaInjection: {
        ...base.schemaInjection,
        includeExamples: false,
      },
      meta: { updatedAt: now, updatedBy: 'self-tuning' },
    },
    rationale: 'Test if removing tool examples saves tokens without hurting accuracy.',
  });

  return candidates;
}
