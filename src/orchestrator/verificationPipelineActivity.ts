// Verification pipeline activity — wraps runVerificationPipeline as a DF activity.
// Spec ref: 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import { runVerificationPipeline, type VerificationInput } from './verificationPipeline.js';

df.app.activity('verificationPipelineActivity', {
  handler: async (input: VerificationInput) => {
    return runVerificationPipeline(input);
  },
});
