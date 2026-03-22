// Eval Store — tracks benchmark results for model profiles.
// Git-tracked JSON files in model-profiles/<model-id>/eval-history.json.
// Spec ref: 0m-Agentic-Tooling-Evaluation.md §2 — Eval Store
// Issue #96

import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const EvalScoreSchema = z.object({
  /** Success rate (0-1) — did the model use the right tool? */
  successRate: z.number().min(0).max(1),
  /** Average latency in ms */
  avgLatencyMs: z.number().min(0),
  /** Token efficiency — (useful tokens / total tokens) */
  tokenEfficiency: z.number().min(0).max(1),
  /** Safety pass rate — did it pass prompt shields + verification? */
  safetyPassRate: z.number().min(0).max(1),
  /** Verification pipeline pass rate */
  verificationPassRate: z.number().min(0).max(1),
});

export type EvalScore = z.infer<typeof EvalScoreSchema>;

export const EvalResultSchema = z.object({
  /** Unique eval run ID */
  runId: z.string(),
  /** Model deployment name */
  model: z.string(),
  /** Profile version that was tested */
  profileVersion: z.number(),
  /** When this eval ran */
  timestamp: z.string(),
  /** Number of tasks executed */
  taskCount: z.number().int().min(0),
  /** Weighted composite score (0-1) */
  compositeScore: z.number().min(0).max(1),
  /** Breakdown scores */
  scores: EvalScoreSchema,
  /** Whether this result was promoted as the active profile */
  promoted: z.boolean(),
  /** Candidate mask variant name (e.g. "flat_json_compact") */
  candidateName: z.string(),
  /** Optional notes */
  notes: z.string().optional(),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;

export const EvalHistorySchema = z.object({
  model: z.string(),
  results: z.array(EvalResultSchema),
});

export type EvalHistory = z.infer<typeof EvalHistorySchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROFILES_DIR = resolve(join(import.meta.dirname ?? __dirname, '..', '..', '..', 'model-profiles'));
const MAX_HISTORY_ENTRIES = 50;

// ---------------------------------------------------------------------------
// Score weights (from spec §4 — Scoring & Promotion)
// ---------------------------------------------------------------------------

export const SCORE_WEIGHTS = {
  successRate: 0.40,
  tokenEfficiency: 0.20,
  avgLatencyMs: 0.15, // inverted — lower is better
  safetyPassRate: 0.15,
  verificationPassRate: 0.10,
} as const;

/** Compute weighted composite score from individual scores */
export function computeCompositeScore(scores: EvalScore): number {
  // Latency score: normalize to 0-1 range (assume 30s is worst, 0s is best)
  const latencyScore = Math.max(0, 1 - scores.avgLatencyMs / 30_000);

  return (
    scores.successRate * SCORE_WEIGHTS.successRate +
    scores.tokenEfficiency * SCORE_WEIGHTS.tokenEfficiency +
    latencyScore * SCORE_WEIGHTS.avgLatencyMs +
    scores.safetyPassRate * SCORE_WEIGHTS.safetyPassRate +
    scores.verificationPassRate * SCORE_WEIGHTS.verificationPassRate
  );
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

function historyPath(modelId: string): string {
  return join(PROFILES_DIR, modelId, 'eval-history.json');
}

/** Load eval history for a model */
export function loadEvalHistory(modelId: string): EvalHistory {
  const path = historyPath(modelId);
  if (!existsSync(path)) {
    return { model: modelId, results: [] };
  }
  const raw = readFileSync(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const result = EvalHistorySchema.safeParse(parsed);
  if (!result.success) {
    return { model: modelId, results: [] };
  }
  return result.data;
}

/** Save eval history for a model (truncates to MAX_HISTORY_ENTRIES) */
export function saveEvalHistory(modelId: string, history: EvalHistory): void {
  const dir = join(PROFILES_DIR, modelId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Keep only the most recent entries
  const trimmed: EvalHistory = {
    ...history,
    results: history.results.slice(-MAX_HISTORY_ENTRIES),
  };
  writeFileSync(historyPath(modelId), JSON.stringify(trimmed, null, 2) + '\n', 'utf-8');
}

/** Append a new eval result */
export function recordEvalResult(modelId: string, result: EvalResult): void {
  const history = loadEvalHistory(modelId);
  history.results.push(result);
  saveEvalHistory(modelId, history);
}

/** Get the latest promoted result for a model */
export function getLatestPromotedResult(modelId: string): EvalResult | null {
  const history = loadEvalHistory(modelId);
  const promoted = history.results.filter(r => r.promoted);
  return promoted.length > 0 ? promoted[promoted.length - 1] : null;
}

/** Get the most recent N eval results for a model */
export function getRecentResults(modelId: string, limit = 10): EvalResult[] {
  const history = loadEvalHistory(modelId);
  return history.results.slice(-limit);
}
