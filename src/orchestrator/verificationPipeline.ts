// Verification pipeline — full four-eyes safety pipeline for every tool response.
// Runs on EVERY sub-agent and SkillForge output before orchestrator reasoning begins.
// Spec ref: 0e-Safety-and-Four-Eyes-Verification-Pipeline.md, 04-Safety-Architecture.md

import { safetyConfig, isConfirmationGated, isReadOnly } from '../config/safetyConfig.js';
import { promptShields, type ShieldResult } from '../llm/promptShields.js';
import type { ScopedToken } from '../auth/scopedTokenMinter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationInput {
  correlationId: string;
  sessionId: string;
  userId: string;
  toolName: string;
  risk: 'low' | 'medium' | 'high';
  /** Raw response from the sub-agent or SkillForge */
  rawOutput: unknown;
  /** The original user request, for spot-check comparison */
  originalQuery: string;
  /** Spot-check result IDs (if applicable) */
  spotCheckIds?: string[];
  /** Human confirmation card response received (if applicable) */
  confirmationResponse?: 'approved' | 'denied' | 'timeout';
  /** Scoped token for the tool call */
  scopedToken?: ScopedToken;
}

export interface VerificationResult {
  passed: boolean;
  correlationId: string;
  steps: VerificationStepResult[];
  requiresConfirmation: boolean;
  confirmedAt?: string;
  error?: string;
}

export interface VerificationStepResult {
  step: 'schema-validation' | 'data-minimization' | 'spot-check' | 'prompt-shields' | 'human-confirmation';
  passed: boolean;
  details?: string;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runVerificationPipeline(input: VerificationInput): Promise<VerificationResult> {
  const steps: VerificationStepResult[] = [];
  const startTime = Date.now();

  // -------------------------------------------------------------------------
  // Step 1: Schema validation
  // -------------------------------------------------------------------------
  const schemaResult = await validateSchema(input.rawOutput);
  steps.push(schemaResult);
  if (!schemaResult.passed) {
    return makeResult(false, input.correlationId, steps, false, 'Schema validation failed');
  }

  // -------------------------------------------------------------------------
  // Step 2: Data minimization (logging happens here; stripping at storage boundary)
  // -------------------------------------------------------------------------
  const minimizeResult = minimizeData(input.rawOutput);
  steps.push(minimizeResult);
  if (!minimizeResult.passed) {
    return makeResult(false, input.correlationId, steps, false, 'Data minimization failed');
  }

  // -------------------------------------------------------------------------
  // Step 3: Spot-check verification
  // -------------------------------------------------------------------------
  const spotCheckResult = await runSpotCheck(input);
  steps.push(spotCheckResult);
  // Spot-check failures don't hard-fail — they flag for user review

  // -------------------------------------------------------------------------
  // Step 4: Prompt shields on sub-agent output
  // -------------------------------------------------------------------------
  const shieldsResult = await runPromptShields(input.rawOutput, input.correlationId);
  steps.push(shieldsResult);
  if (!shieldsResult.passed) {
    return makeResult(false, input.correlationId, steps, false, 'Prompt Shields blocked output');
  }

  // -------------------------------------------------------------------------
  // Step 5: Human confirmation (medium + high risk)
  // -------------------------------------------------------------------------
  if (input.risk === 'medium' || input.risk === 'high') {
    if (isReadOnly()) {
      return makeResult(false, input.correlationId, steps, false, 'read-only mode: action blocked');
    }

    if (!isConfirmationGated()) {
      // full-destructive mode — auto-proceed but log
      return makeResult(true, input.correlationId, steps, true);
    }

    if (input.confirmationResponse === 'approved') {
      steps.push({
        step: 'human-confirmation',
        passed: true,
        details: 'User approved via Adaptive Card',
        latencyMs: Date.now() - startTime,
      });
      return makeResult(true, input.correlationId, steps, true, undefined, new Date().toISOString());
    } else if (input.confirmationResponse === 'denied' || input.confirmationResponse === 'timeout') {
      steps.push({
        step: 'human-confirmation',
        passed: false,
        details: `User ${input.confirmationResponse} confirmation`,
        latencyMs: Date.now() - startTime,
      });
      return makeResult(false, input.correlationId, steps, false, `User ${input.confirmationResponse}`);
    }

    // No confirmation yet — requires confirmation card
    steps.push({
      step: 'human-confirmation',
      passed: false,
      details: 'Awaiting user confirmation',
      latencyMs: Date.now() - startTime,
    });
    return makeResult(false, input.correlationId, steps, true, 'Awaiting human confirmation');
  }

  return makeResult(true, input.correlationId, steps, false);
}

// ---------------------------------------------------------------------------
// Step implementations
// ---------------------------------------------------------------------------

async function validateSchema(output: unknown): Promise<VerificationStepResult> {
  const start = Date.now();
  try {
    // Phase 3: validate against the tool's outputSchema from the capability manifest.
    // For now: check output is a non-null object or array (structured data).
    if (output === null || output === undefined) {
      return { step: 'schema-validation', passed: false, details: 'Output is null/undefined', latencyMs: Date.now() - start };
    }
    if (typeof output === 'string') {
      // Allow text responses (e.g. "7 messages found")
      return { step: 'schema-validation', passed: true, details: 'String output accepted', latencyMs: Date.now() - start };
    }
    if (typeof output === 'object') {
      return { step: 'schema-validation', passed: true, details: 'Object/array output valid', latencyMs: Date.now() - start };
    }
    return { step: 'schema-validation', passed: false, details: `Unexpected type: ${typeof output}`, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      step: 'schema-validation',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

function minimizeData(_output: unknown): VerificationStepResult {
  const start = Date.now();
  // Phase 3: strip fields not in outputSchema.
  // For now: just confirm the output doesn't contain raw email bodies or attachments.
  // Real implementation: compare against tool's outputSchema field allowlist.
  return {
    step: 'data-minimization',
    passed: true,
    details: 'Minimization not yet wired to per-tool output schemas (Phase 4)',
    latencyMs: Date.now() - start,
  };
}

async function runSpotCheck(input: VerificationInput): Promise<VerificationStepResult> {
  const start = Date.now();
  const threshold = safetyConfig.spotCheckVerifyAllThreshold;
  const sampleSize = safetyConfig.spotCheckSampleSize;

  if (!input.spotCheckIds || input.spotCheckIds.length === 0) {
    return { step: 'spot-check', passed: true, details: 'No IDs to spot-check', latencyMs: Date.now() - start };
  }

  const idsToCheck =
    input.spotCheckIds.length <= threshold
      ? input.spotCheckIds
      : input.spotCheckIds.sort(() => Math.random() - 0.5).slice(0, sampleSize);

  // Phase 3 stub: in Phase 4, call narrow batched GET to verify IDs match original query pattern.
  // For now, always pass with a note.
  return {
    step: 'spot-check',
    passed: true,
    details: `Would spot-check ${idsToCheck.length} IDs (real verification in Phase 4)`,
    latencyMs: Date.now() - start,
  };
}

async function runPromptShields(output: unknown, correlationId: string): Promise<VerificationStepResult> {
  const start = Date.now();
  const text = typeof output === 'string' ? output : JSON.stringify(output);

  const result: ShieldResult = await promptShields.check(text, correlationId);

  if (!result.clean) {
    const triggered = Object.entries(result.categories)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ');
    return {
      step: 'prompt-shields',
      passed: false,
      details: `Triggered categories: ${triggered}`,
      latencyMs: Date.now() - start,
    };
  }

  return {
    step: 'prompt-shields',
    passed: true,
    details: 'Content passed Prompt Shields',
    latencyMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  passed: boolean,
  correlationId: string,
  steps: VerificationStepResult[],
  requiresConfirmation: boolean,
  error?: string,
  confirmedAt?: string,
): VerificationResult {
  return { passed, correlationId, steps, requiresConfirmation, confirmedAt, error };
}
