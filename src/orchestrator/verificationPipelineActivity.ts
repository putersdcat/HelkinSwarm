// Verification pipeline activity — wraps runVerificationPipeline as a DF activity.
// Spec ref: 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import { runVerificationPipeline, type VerificationInput } from './verificationPipeline.js';
import { trackEvent } from '../observability/telemetry.js';

df.app.activity('verificationPipelineActivity', {
  handler: async (input: VerificationInput) => {
    const result = await runVerificationPipeline(input);
    const spotStep = result.steps.find(s => s.step === 'spot-check');
    trackEvent({ name: 'VerificationPipelineResult', correlationId: input.correlationId, userId: input.userId, properties: {
      passed: result.passed,
      requiresConfirmation: result.requiresConfirmation,
      stepCount: result.steps.length,
      toolName: input.toolName,
      risk: input.risk,
      spotCheckPolicy: input.spotCheckPolicy ?? 'advisory',
      ...(spotStep?.spotCheckDetails ? {
        spotCheckOutcome: spotStep.spotCheckDetails.outcome,
        spotCheckSampledCount: spotStep.spotCheckDetails.sampledCount,
        spotCheckMatchedCount: spotStep.spotCheckDetails.matchedCount,
        spotCheckMismatchedCount: spotStep.spotCheckDetails.mismatchedIds.length,
        spotCheckVerifierUsed: spotStep.spotCheckDetails.verifierUsed ?? 'none',
        spotCheckTotalIds: spotStep.spotCheckDetails.totalIds,
      } : {}),
    } });
    return result;
  },
});
