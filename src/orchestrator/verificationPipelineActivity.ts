// Verification pipeline activity — wraps runVerificationPipeline as a DF activity.
// Spec ref: 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import { runVerificationPipeline, type VerificationInput } from './verificationPipeline.js';
import { trackEvent } from '../observability/telemetry.js';

df.app.activity('verificationPipelineActivity', {
  handler: async (input: VerificationInput) => {
    const result = await runVerificationPipeline(input);
    trackEvent({ name: 'VerificationPipelineResult', correlationId: input.correlationId, userId: input.userId, properties: {
      passed: result.passed,
      requiresConfirmation: result.requiresConfirmation,
      stepCount: result.steps.length,
      toolName: input.toolName,
      risk: input.risk,
    } });
    return result;
  },
});
