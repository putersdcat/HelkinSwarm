// Regression Guard — detects score regressions and triggers rollback.
// Spec ref: 0m-Agentic-Tooling-Evaluation.md §4 — Regression Guard
// Issue #96

import { type EvalResult, getLatestPromotedResult, getRecentResults } from './evalStore.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Threshold for regression detection — ≥10% drop triggers rollback (spec §4) */
const REGRESSION_THRESHOLD = 0.10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegressionCheckResult {
  /** Whether a regression was detected */
  regressed: boolean;
  /** Current composite score */
  currentScore: number;
  /** Baseline composite score (last promoted) */
  baselineScore: number | null;
  /** Score delta (negative = regression) */
  delta: number | null;
  /** Human-readable summary */
  summary: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a new eval result represents a regression from the promoted baseline.
 * Returns regression info — caller decides what to do (rollback, alert, etc.).
 */
export function checkRegression(
  modelId: string,
  newResult: EvalResult,
): RegressionCheckResult {
  const baseline = getLatestPromotedResult(modelId);

  if (!baseline) {
    return {
      regressed: false,
      currentScore: newResult.compositeScore,
      baselineScore: null,
      delta: null,
      summary: `No baseline for ${modelId} — first eval, no regression possible.`,
    };
  }

  const delta = newResult.compositeScore - baseline.compositeScore;
  const dropPct = -delta / baseline.compositeScore;
  const regressed = dropPct >= REGRESSION_THRESHOLD;

  return {
    regressed,
    currentScore: newResult.compositeScore,
    baselineScore: baseline.compositeScore,
    delta,
    summary: regressed
      ? `REGRESSION: ${modelId} dropped ${(dropPct * 100).toFixed(1)}% (${baseline.compositeScore.toFixed(3)} → ${newResult.compositeScore.toFixed(3)}). Rollback recommended.`
      : `OK: ${modelId} score ${newResult.compositeScore.toFixed(3)} (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} from baseline ${baseline.compositeScore.toFixed(3)}).`,
  };
}

/**
 * Detect if there's a sustained regression over the last N runs
 * (useful for noisy benchmarks where a single bad run shouldn't trigger rollback).
 */
export function checkSustainedRegression(
  modelId: string,
  windowSize = 3,
): { regressed: boolean; avgScore: number; summary: string } {
  const recent = getRecentResults(modelId, windowSize);
  const baseline = getLatestPromotedResult(modelId);

  if (recent.length < windowSize || !baseline) {
    return {
      regressed: false,
      avgScore: 0,
      summary: `Insufficient data for sustained regression check on ${modelId}.`,
    };
  }

  const avgScore = recent.reduce((sum, r) => sum + r.compositeScore, 0) / recent.length;
  const dropPct = (baseline.compositeScore - avgScore) / baseline.compositeScore;
  const regressed = dropPct >= REGRESSION_THRESHOLD;

  return {
    regressed,
    avgScore,
    summary: regressed
      ? `SUSTAINED REGRESSION: ${modelId} avg score ${avgScore.toFixed(3)} over last ${windowSize} runs, ${(dropPct * 100).toFixed(1)}% below baseline ${baseline.compositeScore.toFixed(3)}.`
      : `OK: ${modelId} avg score ${avgScore.toFixed(3)} over last ${windowSize} runs.`,
  };
}
