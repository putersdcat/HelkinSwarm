// Profile applicator — transforms tool definitions based on the active model profile.
// Sits between capability loader and LLM call, applying per-model masks.
// Spec ref: 0b-Model-Specific-Tool-Presentation.md §3 — Profile Applicator
// Issue #95

import type { ModelProfile } from './modelProfileSchema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A tool definition as presented to the LLM (OpenAI function-calling shape) */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ApplyProfileResult {
  /** Filtered/transformed tools ready for the LLM */
  tools: ToolDefinition[];
  /** Tools that were excluded by the profile */
  excluded: string[];
  /** Whether any transformation was applied */
  wasTransformed: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply a model profile's masks to a set of tool definitions.
 * Returns a new tool array — does not mutate the input.
 *
 * If profile is null, returns tools unchanged (graceful no-op).
 */
export function applyProfile(
  tools: ToolDefinition[],
  profile: ModelProfile | null,
): ApplyProfileResult {
  if (!profile) {
    return { tools, excluded: [], wasTransformed: false };
  }

  let filtered = [...tools];
  const excluded: string[] = [];

  // 1. Exclude tools the profile says perform poorly with this model
  if (profile.excludeTools.length > 0) {
    const excludeSet = new Set(profile.excludeTools);
    filtered = filtered.filter(t => {
      if (excludeSet.has(t.function.name)) {
        excluded.push(t.function.name);
        return false;
      }
      return true;
    });
  }

  // 2. Boost tools — move them to the front of the array (LLMs attend more to earlier tools)
  if (profile.boostTools.length > 0) {
    const boostSet = new Set(profile.boostTools);
    const boosted = filtered.filter(t => boostSet.has(t.function.name));
    const rest = filtered.filter(t => !boostSet.has(t.function.name));
    filtered = [...boosted, ...rest];
  }

  // 3. Max tools per turn — truncate if needed
  if (profile.maxToolsPerTurn > 0 && filtered.length > profile.maxToolsPerTurn) {
    const dropped = filtered.slice(profile.maxToolsPerTurn);
    excluded.push(...dropped.map(t => t.function.name));
    filtered = filtered.slice(0, profile.maxToolsPerTurn);
  }

  // 4. Compact mode — strip descriptions to save context window
  if (profile.schemaInjection.compact) {
    filtered = filtered.map(t => ({
      ...t,
      function: {
        ...t.function,
        description: t.function.description.split('.')[0] + '.',
      },
    }));
  }

  return {
    tools: filtered,
    excluded,
    wasTransformed: true,
  };
}
