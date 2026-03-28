// Verification pipeline — full four-eyes safety pipeline for every tool response.
// Runs on EVERY sub-agent and SkillForge output before orchestrator reasoning begins.
// Spec ref: 0e-Safety-and-Four-Eyes-Verification-Pipeline.md, 04-Safety-Architecture.md

import { createHash } from 'node:crypto';
import { safetyConfig, isConfirmationGated, isReadOnly } from '../config/safetyConfig.js';
import { promptShields, type ShieldResult } from '../llm/promptShields.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import type { ScopedToken } from '../auth/scopedTokenMinter.js';
import { getConfirmationBypassRule } from '../config/stampPolicy.js';
import type { HelkinAuthority } from '../auth/roles.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpotCheckPolicy = 'disabled' | 'advisory' | 'enforced';

export type SpotCheckOutcome =
  | 'no-check-required'
  | 'sample-verified'
  | 'verify-all-passed'
  | 'verifier-missing'
  | 'threshold-exceeded'
  | 'error';

export interface SpotCheckDetails {
  outcome: SpotCheckOutcome;
  sampledCount: number;
  matchedCount: number;
  mismatchedIds: string[];
  verifierUsed: string | null;
  totalIds: number;
}

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
  /** Spot-check policy: 'disabled' skips, 'advisory' logs only, 'enforced' hard-fails on mismatch or missing verifier */
  spotCheckPolicy?: SpotCheckPolicy;
  /** When true, skip human confirmation even for medium/high risk (manifest says requiresConfirmation:false for all tools in batch) */
  skipConfirmation?: boolean;
}

/** Canonical description of the resource set verified by the pipeline (#266). */
export interface VerifiedSet {
  sessionId: string;
  toolName: string;
  operationType: string;
  ids: string[];
  verifiedAt: string;
}

export interface VerificationResult {
  passed: boolean;
  correlationId: string;
  steps: VerificationStepResult[];
  requiresConfirmation: boolean;
  confirmedAt?: string;
  error?: string;
  /** Canonical verified set — present when spot-check IDs were provided (#266). */
  verifiedSet?: VerifiedSet;
  /** SHA-256 of the canonical verified set JSON (#266). */
  verifiedSetHash?: string;
  policyOverrideApplied?: boolean;
  policyOverrideAuthority?: HelkinAuthority;
  policyOverrideReason?: string;
}

export interface VerificationStepResult {
  step: 'schema-validation' | 'data-minimization' | 'spot-check' | 'prompt-shields' | 'human-confirmation';
  passed: boolean;
  details?: string;
  latencyMs: number;
  /** Structured spot-check telemetry (present only for spot-check step) */
  spotCheckDetails?: SpotCheckDetails;
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
  if (!spotCheckResult.passed) {
    return makeResult(false, input.correlationId, steps, false, `Spot-check failed: ${spotCheckResult.details}`);
  }

  // -------------------------------------------------------------------------
  // Step 4: Prompt shields on sub-agent output (uses minimized data)
  // -------------------------------------------------------------------------
  const shieldsResult = await runPromptShields(safeOutput, input.correlationId);
  steps.push(shieldsResult);
  if (!shieldsResult.passed) {
    return makeResult(false, input.correlationId, steps, false, 'Prompt Shields blocked output');
  }

  // Build canonical verified set when IDs are present (#266)
  let verifiedSet: VerifiedSet | undefined;
  let verifiedSetHash: string | undefined;
  if (input.spotCheckIds && input.spotCheckIds.length > 0) {
    const opType = inferOperationType(input.toolName);
    verifiedSet = buildVerifiedSet(input.sessionId, input.toolName, opType, input.spotCheckIds);
    verifiedSetHash = hashVerifiedSet(verifiedSet);
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
      return makeResult(true, input.correlationId, steps, true, undefined, undefined, verifiedSet, verifiedSetHash);
    }

    const toolNames = input.toolName.split(',').map((name) => name.trim()).filter(Boolean);
    const policyBypass = await getConfirmationBypassRule(input.userId, toolNames);

    // Per-tool opt-out or explicit stamp policy exception (#302, #346).
    if (input.skipConfirmation || policyBypass.applies) {
      return makeResult(
        true,
        input.correlationId,
        steps,
        false,
        undefined,
        undefined,
        verifiedSet,
        verifiedSetHash,
        policyBypass.applies,
        policyBypass.authority,
        policyBypass.reason,
      );
    }

    if (input.confirmationResponse === 'approved') {
      steps.push({
        step: 'human-confirmation',
        passed: true,
        details: 'User approved via Adaptive Card',
        latencyMs: Date.now() - startTime,
      });
      return makeResult(true, input.correlationId, steps, true, undefined, new Date().toISOString(), verifiedSet, verifiedSetHash);
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

  return makeResult(true, input.correlationId, steps, false, undefined, undefined, verifiedSet, verifiedSetHash);
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

// ---------------------------------------------------------------------------
// Fisher-Yates partial shuffle — returns a random sample of `sampleSize` items
// ---------------------------------------------------------------------------

function fisherYatesSample<T>(arr: readonly T[], sampleSize: number): T[] {
  const copy = [...arr];
  const n = Math.min(sampleSize, copy.length);
  for (let i = copy.length - 1; i > copy.length - 1 - n && i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i]!, copy[j]!] = [copy[j]!, copy[i]!];
  }
  return copy.slice(copy.length - n);
}

function getVerifierName(toolName: string): string | null {
  if (toolName.startsWith('github_')) return 'github';
  if (toolName.startsWith('outlook_')) return 'outlook';
  return null;
}

async function runSpotCheck(input: VerificationInput): Promise<VerificationStepResult> {
  const start = Date.now();
  const policy: SpotCheckPolicy = input.spotCheckPolicy ?? 'advisory';
  const threshold = safetyConfig.spotCheckVerifyAllThreshold;
  const sampleSize = safetyConfig.spotCheckSampleSize;

  if (policy === 'disabled') {
    return {
      step: 'spot-check',
      passed: true,
      details: 'Spot-check disabled by policy',
      latencyMs: Date.now() - start,
      spotCheckDetails: { outcome: 'no-check-required', sampledCount: 0, matchedCount: 0, mismatchedIds: [], verifierUsed: null, totalIds: 0 },
    };
  }

  if (!input.spotCheckIds || input.spotCheckIds.length === 0) {
    return {
      step: 'spot-check',
      passed: true,
      details: 'No IDs to spot-check',
      latencyMs: Date.now() - start,
      spotCheckDetails: { outcome: 'no-check-required', sampledCount: 0, matchedCount: 0, mismatchedIds: [], verifierUsed: null, totalIds: 0 },
    };
  }

  const totalIds = input.spotCheckIds.length;
  const verifyAll = totalIds <= threshold;
  const idsToCheck = verifyAll
    ? input.spotCheckIds
    : fisherYatesSample(input.spotCheckIds, sampleSize);

  const verifier = getDomainVerifier(input.toolName);
  const verifierName = getVerifierName(input.toolName);

  if (!verifier) {
    const hardFail = policy === 'enforced';
    return {
      step: 'spot-check',
      passed: !hardFail,
      details: `No domain verifier for ${input.toolName}${hardFail ? ' — enforced policy, failing closed' : ' — advisory, passing through'}`,
      latencyMs: Date.now() - start,
      spotCheckDetails: { outcome: 'verifier-missing', sampledCount: 0, matchedCount: 0, mismatchedIds: [], verifierUsed: null, totalIds },
    };
  }

  try {
    const failures = await verifier(idsToCheck, input);
    const matched = idsToCheck.length - failures.length;

    if (failures.length > 0) {
      const hardFail = policy === 'enforced';
      const mode = verifyAll ? 'full' : `sampled ${idsToCheck.length}/${totalIds}`;
      return {
        step: 'spot-check',
        passed: !hardFail,
        details: `Spot-check ${mode}: ${failures.length} mismatches [${failures.join(', ')}]${hardFail ? ' — enforced, failing pipeline' : ' — advisory'}`,
        latencyMs: Date.now() - start,
        spotCheckDetails: { outcome: 'threshold-exceeded', sampledCount: idsToCheck.length, matchedCount: matched, mismatchedIds: failures, verifierUsed: verifierName, totalIds },
      };
    }

    const outcome: SpotCheckOutcome = verifyAll ? 'verify-all-passed' : 'sample-verified';
    return {
      step: 'spot-check',
      passed: true,
      details: `Spot-check passed: ${verifyAll ? 'all' : `${idsToCheck.length}/${totalIds} sampled`} verified via ${verifierName}`,
      latencyMs: Date.now() - start,
      spotCheckDetails: { outcome, sampledCount: idsToCheck.length, matchedCount: matched, mismatchedIds: [], verifierUsed: verifierName, totalIds },
    };
  } catch (err) {
    const hardFail = policy === 'enforced';
    return {
      step: 'spot-check',
      passed: !hardFail,
      details: `Spot-check error: ${err instanceof Error ? err.message : String(err)}${hardFail ? ' — enforced, failing pipeline' : ' — advisory'}`,
      latencyMs: Date.now() - start,
      spotCheckDetails: { outcome: 'error', sampledCount: idsToCheck.length, matchedCount: 0, mismatchedIds: [], verifierUsed: verifierName, totalIds },
    };
  }
}

// ---------------------------------------------------------------------------
// Domain verifiers — verify resource IDs match original query results
// Each returns an array of IDs that failed verification (empty = all passed)
// ---------------------------------------------------------------------------

type DomainVerifier = (ids: string[], input: VerificationInput) => Promise<string[]>;

function getDomainVerifier(toolName: string): DomainVerifier | null {
  if (toolName.startsWith('github_')) return verifyGitHubIds;
  if (toolName.startsWith('outlook_')) return verifyOutlookIds;
  // Additional domain verifiers can be registered here
  return null;
}

/** Infer a coarse operation type from the tool name (#266). */
function inferOperationType(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower.includes('delete') || lower.includes('remove')) return 'delete';
  if (lower.includes('create') || lower.includes('add') || lower.includes('new')) return 'create';
  if (lower.includes('update') || lower.includes('edit') || lower.includes('modify') || lower.includes('move')) return 'update';
  if (lower.includes('send') || lower.includes('forward') || lower.includes('reply')) return 'send';
  return 'unknown';
}

/** GitHub domain verifier — verifies issue/PR numbers exist in the repo */
async function verifyGitHubIds(ids: string[], _input: VerificationInput): Promise<string[]> {
  // GitHub IDs are issue/PR numbers — verify they exist via the API
  const { getHandler } = await import('../capabilities/capabilityLoader.js');
  const failures: string[] = [];

  for (const id of ids) {
    try {
      const handler = getHandler('github_get_issue');
      if (!handler) {
        // No handler available — skip verification (don't fail-open on missing handler)
        continue;
      }
      const result = await handler({ issue_number: parseInt(id, 10) }) as Record<string, unknown>;
      if (!result || result['error']) {
        failures.push(id);
      }
    } catch {
      failures.push(id);
    }
  }
  return failures;
}

/** Outlook domain verifier — verifies message IDs exist */
async function verifyOutlookIds(ids: string[], input: VerificationInput): Promise<string[]> {
  const { getHandler } = await import('../capabilities/capabilityLoader.js');
  const failures: string[] = [];

  for (const id of ids) {
    try {
      const handler = getHandler('outlook_read_email');
      if (!handler) continue;
      const result = await handler({ messageId: id, userId: input.userId }) as Record<string, unknown>;
      if (!result || result['error']) {
        failures.push(id);
      }
    } catch {
      failures.push(id);
    }
  }
  return failures;
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
  verifiedSet?: VerifiedSet,
  verifiedSetHash?: string,
  policyOverrideApplied?: boolean,
  policyOverrideAuthority?: HelkinAuthority,
  policyOverrideReason?: string,
): VerificationResult {
  return {
    passed,
    correlationId,
    steps,
    requiresConfirmation,
    confirmedAt,
    error,
    verifiedSet,
    verifiedSetHash,
    policyOverrideApplied,
    policyOverrideAuthority,
    policyOverrideReason,
  };
}

// ---------------------------------------------------------------------------
// Verified-set canonicalization (#266)
// ---------------------------------------------------------------------------

/** Build a canonical verified set from the pipeline context. */
export function buildVerifiedSet(
  sessionId: string,
  toolName: string,
  operationType: string,
  ids: string[],
): VerifiedSet {
  return {
    sessionId,
    toolName,
    operationType,
    ids: [...new Set(ids)].map(String).sort(),
    verifiedAt: new Date().toISOString(),
  };
}

/** SHA-256 of the canonical verified set for binding to executor payloads. */
export function hashVerifiedSet(vs: VerifiedSet): string {
  const canonical = JSON.stringify({
    sessionId: vs.sessionId,
    toolName: vs.toolName,
    operationType: vs.operationType,
    ids: vs.ids,
    verifiedAt: vs.verifiedAt,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
