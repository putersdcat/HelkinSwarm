// Verification pipeline — full four-eyes safety pipeline for every tool response.
// Runs on EVERY sub-agent and SkillForge output before orchestrator reasoning begins.
// Spec ref: 0e-Safety-and-Four-Eyes-Verification-Pipeline.md, 04-Safety-Architecture.md

import { safetyConfig, isConfirmationGated, isReadOnly } from '../config/safetyConfig.js';
import { promptShields, type ShieldResult } from '../llm/promptShields.js';
import { toolRegistry } from '../tools/toolRegistry.js';
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
  const schemaResult = await validateSchema(input.rawOutput, input.toolName);
  steps.push(schemaResult);
  if (!schemaResult.passed) {
    return makeResult(false, input.correlationId, steps, false, 'Schema validation failed');
  }

  // -------------------------------------------------------------------------
  // Step 2: Data minimization (strips undeclared fields based on outputSchema)
  // -------------------------------------------------------------------------
  const { result: minimizeResult, minimized } = minimizeData(input.rawOutput, input.toolName);
  steps.push(minimizeResult);
  if (!minimizeResult.passed) {
    return makeResult(false, input.correlationId, steps, false, 'Data minimization failed');
  }
  // Use minimized output for downstream steps
  const safeOutput = minimized;

  // -------------------------------------------------------------------------
  // Step 3: Spot-check verification
  // -------------------------------------------------------------------------
  const spotCheckResult = await runSpotCheck(input);
  steps.push(spotCheckResult);
  // Spot-check failures don't hard-fail — they flag for user review

  // -------------------------------------------------------------------------
  // Step 4: Prompt shields on sub-agent output (uses minimized data)
  // -------------------------------------------------------------------------
  const shieldsResult = await runPromptShields(safeOutput, input.correlationId);
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

async function validateSchema(output: unknown, toolName: string): Promise<VerificationStepResult> {
  const start = Date.now();
  try {
    if (output === null || output === undefined) {
      return { step: 'schema-validation', passed: false, details: 'Output is null/undefined', latencyMs: Date.now() - start };
    }

    // String responses (e.g. "7 messages found") always pass — they're narrative, not structured data
    if (typeof output === 'string') {
      return { step: 'schema-validation', passed: true, details: 'String output accepted', latencyMs: Date.now() - start };
    }

    if (typeof output !== 'object') {
      return { step: 'schema-validation', passed: false, details: `Unexpected type: ${typeof output}`, latencyMs: Date.now() - start };
    }

    // Look up the tool's outputSchema from the registry
    const toolDef = toolRegistry.get(toolName);
    const outputSchema = toolDef?.outputSchema as Record<string, unknown> | undefined;

    if (!outputSchema || !outputSchema['properties']) {
      // No outputSchema defined — accept any structured data
      return { step: 'schema-validation', passed: true, details: 'No outputSchema defined; structured output accepted', latencyMs: Date.now() - start };
    }

    // Validate: check that output matches expected shape from outputSchema
    const schemaProps = outputSchema['properties'] as Record<string, unknown>;
    const requiredFields = (outputSchema['required'] as string[]) ?? [];
    const outputObj = output as Record<string, unknown>;

    // Check required fields are present
    const missingRequired = requiredFields.filter(f => !(f in outputObj));
    if (missingRequired.length > 0) {
      return {
        step: 'schema-validation',
        passed: false,
        details: `Missing required fields: ${missingRequired.join(', ')}`,
        latencyMs: Date.now() - start,
      };
    }

    // Check for fields not declared in the schema (hallucinated/injected fields)
    const declaredFields = new Set(Object.keys(schemaProps));
    const extraFields = Object.keys(outputObj).filter(k => !declaredFields.has(k));
    if (extraFields.length > 0) {
      return {
        step: 'schema-validation',
        passed: false,
        details: `Undeclared fields found: ${extraFields.join(', ')}`,
        latencyMs: Date.now() - start,
      };
    }

    return { step: 'schema-validation', passed: true, details: `Validated against outputSchema (${declaredFields.size} fields)`, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      step: 'schema-validation',
      passed: false,
      details: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

function minimizeData(output: unknown, toolName: string): { result: VerificationStepResult; minimized: unknown } {
  const start = Date.now();

  // Non-object types don't need minimization
  if (output === null || output === undefined || typeof output !== 'object') {
    return {
      result: { step: 'data-minimization', passed: true, details: 'Non-object output — no minimization needed', latencyMs: Date.now() - start },
      minimized: output,
    };
  }

  const toolDef = toolRegistry.get(toolName);
  const outputSchema = toolDef?.outputSchema as Record<string, unknown> | undefined;

  if (!outputSchema || !outputSchema['properties']) {
    return {
      result: { step: 'data-minimization', passed: true, details: 'No outputSchema defined — pass-through', latencyMs: Date.now() - start },
      minimized: output,
    };
  }

  const declaredFields = new Set(Object.keys(outputSchema['properties'] as Record<string, unknown>));

  // Handle arrays: minimize each element
  if (Array.isArray(output)) {
    let totalStripped = 0;
    const minimized = output.map(item => {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        const before = Object.keys(obj).length;
        const stripped: Record<string, unknown> = {};
        for (const key of Object.keys(obj)) {
          if (declaredFields.has(key)) stripped[key] = obj[key];
        }
        totalStripped += before - Object.keys(stripped).length;
        return stripped;
      }
      return item;
    });
    return {
      result: {
        step: 'data-minimization',
        passed: true,
        details: `Array of ${output.length} items, stripped ${totalStripped} undeclared fields total`,
        latencyMs: Date.now() - start,
      },
      minimized,
    };
  }

  // Handle single object
  const obj = output as Record<string, unknown>;
  const beforeCount = Object.keys(obj).length;
  const stripped: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (declaredFields.has(key)) stripped[key] = obj[key];
  }
  const afterCount = Object.keys(stripped).length;

  return {
    result: {
      step: 'data-minimization',
      passed: true,
      details: `Fields before: ${beforeCount}, after: ${afterCount}, stripped: ${beforeCount - afterCount}`,
      latencyMs: Date.now() - start,
    },
    minimized: stripped,
  };
}

async function runSpotCheck(input: VerificationInput): Promise<VerificationStepResult> {
  const start = Date.now();
  const threshold = safetyConfig.spotCheckVerifyAllThreshold;
  const sampleSize = safetyConfig.spotCheckSampleSize;

  if (!input.spotCheckIds || input.spotCheckIds.length === 0) {
    return { step: 'spot-check', passed: true, details: 'No IDs to spot-check', latencyMs: Date.now() - start };
  }

  const totalIds = input.spotCheckIds.length;
  const idsToCheck =
    totalIds <= threshold
      ? input.spotCheckIds
      : input.spotCheckIds.sort(() => Math.random() - 0.5).slice(0, sampleSize);

  // Spot-check verification: narrow batched GET to verify IDs match original query.
  // The actual verification call depends on the tool's domain (Graph, GitHub, etc.)
  // and requires a scoped token. When executors are wired (Phase 4+), each domain
  // provides a verifyIds(ids, query, token) function registered on the tool manifest.
  // For now: log the sampling decision and pass — the structural framework is ready.
  const mode = totalIds <= threshold ? 'full' : `sampled ${idsToCheck.length}/${totalIds}`;
  return {
    step: 'spot-check',
    passed: true,
    details: `Spot-check: ${mode} IDs selected for verification (domain verifier pending)`,
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
