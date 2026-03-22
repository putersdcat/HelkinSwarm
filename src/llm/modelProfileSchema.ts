// Model Profile Schema — defines the shape of per-model tool presentation profiles.
// Profiles (aka "mask files") control how tools are presented to each LLM.
// Spec ref: 0b-Model-Specific-Tool-Presentation.md, 0m-Agentic-Tooling-Evaluation.md
// Issue #95

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ModelProfileSchema = z.object({
  /** Model deployment name (must match modelRouter deployment names) */
  model: z.string(),
  /** Profile format version for future migrations */
  version: z.literal(1),
  /** How tools are presented to this model */
  presentation: z.enum(['flat_json', 'progressive', 'mcp', 'cli_mimic']),
  /** Maximum tools sent in a single turn (0 = unlimited) */
  maxToolsPerTurn: z.number().int().min(0).default(0),
  /** Progressive reveal settings (only used when presentation = 'progressive') */
  progressiveReveal: z.object({
    /** Initial tools shown before any user input */
    initialToolCount: z.number().int().min(1).default(5),
    /** How many more tools to reveal per expansion */
    expansionStep: z.number().int().min(1).default(5),
  }).optional(),
  /** Schema injection preferences */
  schemaInjection: z.object({
    /** Include JSON schema in tool descriptions */
    includeJsonSchema: z.boolean().default(true),
    /** Include example calls */
    includeExamples: z.boolean().default(true),
    /** Compact mode — strip descriptions to save context */
    compact: z.boolean().default(false),
  }).default({}),
  /** Preferred naming convention for tool names */
  preferredNaming: z.enum(['snake_case', 'camelCase', 'dot.notation']).default('snake_case'),
  /** Example tool calls that help the model understand usage patterns */
  examples: z.array(z.object({
    tool: z.string(),
    input: z.record(z.unknown()),
    description: z.string().optional(),
  })).default([]),
  /** Known limitations of this model for tool use */
  knownLimitations: z.array(z.string()).default([]),
  /** Tools that perform poorly with this model — deprioritize or exclude */
  excludeTools: z.array(z.string()).default([]),
  /** Tools that perform well — boost priority */
  boostTools: z.array(z.string()).default([]),
  /** Metadata — when this profile was last updated and by what */
  meta: z.object({
    updatedAt: z.string(),
    updatedBy: z.enum(['manual', 'self-tuning', 'benchmark']),
    score: z.number().min(0).max(1).optional(),
    benchmarkRunId: z.string().optional(),
  }),
});

export type ModelProfile = z.infer<typeof ModelProfileSchema>;
